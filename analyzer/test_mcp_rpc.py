"""Offline, no-secret tests of Blossom's actual stateless JSON-RPC transport."""
import asyncio
import json
import os
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import sys
sys.path.insert(0, str(Path(__file__).parent))
import blossom_bridge as bridge

TEST_TOKEN='test-credential-longer-than-thirty-two-characters'

class FakeBlossomHandler(BaseHTTPRequestHandler):
    def do_POST(self):
        data=self.rfile.read(int(self.headers.get('Content-Length','0')))
        if self.path != '/mcp':
            self.send_response(404)
            self.end_headers();return
        if self.headers.get('Authorization') != 'Bearer '+TEST_TOKEN:
            self.send_response(401)
            self.send_header('Content-Type','application/json')
            self.end_headers();self.wfile.write(b'{"error":"Bearer authentication required"}');return
        req=json.loads(data)
        if req['method']=='initialize':
            val={'serverInfo':{'name':'blossom-music-dna','version':'test'},'protocolVersion':'2025-06-18','capabilities':{'tools':{}}}
        elif req['method']=='tools/list':
            val={'tools':[{'name':'music_dna_get'},{'name':'music_dna_save_analysis'}]}
        elif req['method']=='tools/call':
            val={'content':[{'type':'text','text':json.dumps({'id':'known'})}],'isError':False}
        else:
            self.send_response(400);self.end_headers();return
        body=json.dumps({'jsonrpc':'2.0','id':req['id'],'result':val}).encode()
        self.send_response(200)
        self.send_header('Content-Type','application/json')
        self.send_header('Content-Length',str(len(body)))
        self.end_headers();self.wfile.write(body)

    def log_message(self,*args):pass

class RpcTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server=ThreadingHTTPServer(('127.0.0.1',0),FakeBlossomHandler)
        cls.thread=threading.Thread(target=cls.server.serve_forever,daemon=True)
        cls.thread.start()
        cls.url=f'http://127.0.0.1:{cls.server.server_port}/mcp'

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.thread.join(timeout=5)
        cls.server.server_close()

    def test_good_bearer_full_mcp_contract(self):
        async def run():
            client=bridge.BlossomHttpRpc(self.url, TEST_TOKEN)
            await client.initialize()
            names=await bridge.assert_tools(client,['music_dna_get','music_dna_save_analysis'])
            self.assertIn('music_dna_get',names)
            obj=bridge.tool_content(await client.call_tool('music_dna_get',{'id':'known'}))
            self.assertEqual(obj,{'id':'known'})
        asyncio.run(run())

    def test_bad_token_clear_error(self):
        async def run():
            client=bridge.BlossomHttpRpc(self.url,'wrong-token-but-long-enough-for-testing')
            with self.assertRaisesRegex(RuntimeError,'HTTP 401'):
                await client.initialize()
        asyncio.run(run())

    def test_url_guard(self):
        for url in ['http://example.org/mcp','https://example.org/not-mcp','file:///tmp/mcp']:
            with self.assertRaises(RuntimeError):bridge.BlossomHttpRpc(url,TEST_TOKEN)

    def test_local_env_only_owner_secure(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            analyzer=root/'analyzer';analyzer.mkdir()
            f=root/'.env'
            f.write_text('BLOSSOM_MCP_WRITE_TOKEN='+TEST_TOKEN+'\n')
            f.chmod(0o600)
            with patch.object(bridge,'ROOT',analyzer),patch.dict(os.environ,{'BLOSSOM_MCP_TOKEN':'','BLOSSOM_MCP_WRITE_TOKEN':''}):
                self.assertEqual(bridge._mcp_auth(self.url),TEST_TOKEN)
                with self.assertRaisesRegex(RuntimeError,'Externe MCP'):
                    bridge._mcp_auth('https://blossom.wenneker.dev/mcp')
                f.chmod(0o644)
                with self.assertRaisesRegex(RuntimeError,'0600'):
                    bridge._mcp_auth(self.url)

if __name__=='__main__':unittest.main()
