#!/usr/bin/env python3
import json
from pathlib import Path
import tempfile
import unittest
import sys
sys.path.insert(0, str(Path(__file__).parent))
import blossom_bridge as b

class BridgeTests(unittest.TestCase):
    def test_manifest_count_and_ids(self):
        recs=b.load_recs()
        self.assertEqual(len(recs),13)
        self.assertEqual(len({x['blossom_id'] for x in recs}),13)

    def test_denies_download_by_default(self):
        with self.assertRaisesRegex(RuntimeError,"authorized-download"):
            b.download_authorized(b.load_recs()[0],"https://www.youtube.com/watch?v=HDsCeC6f0zc")

    def test_url_guard(self):
        self.assertEqual(b.validate_video_url('https://www.youtube.com/watch?v=HDsCeC6f0zc&list=RDtest'),
                         'https://www.youtube.com/watch?v=HDsCeC6f0zc')
        for bad in ['https://example.com/a','file:///secret','http://www.youtube.com/watch?v=HDsCeC6f0zc',
                    'https://www.youtube.com/playlist?list=abc']:
            with self.assertRaises(ValueError):b.validate_video_url(bad)

    def test_low_confidence_bpm_refused(self):
        x=b.load_recs()[0]
        result={"audio_source_provenance":{"sha256":"abc"}, "audio_measurements":{
            "tempo":{"bpm":None,"confidence":"insufficient regular percussion"},
            "duration_seconds":33,"tonality":{},"ebu_r128":{}}}
        with self.assertRaisesRegex(RuntimeError,"BPM"):
            b.publish_payload(x,result,{"analysis":{"summary":"old"}})

    def test_merges_existing_dna_without_pretending_vocal_inference(self):
        x=b.load_recs()[0]
        result={"audio_source_provenance":{"sha256":"0123"},"audio_measurements":{
            "tempo":{"bpm":119.5,"confidence":"moderate (algorithmic)","agreement_fraction":0.8},
            "duration_seconds":220,"tonality":{"key":None},"ebu_r128":{
                "integrated_lufs":-12.0,"loudness_range_lu":5.5},"sample_peak_dbfs":-1.0}}
        previous={"analysis":{"genres":["Rave"],"moods":["Hypnotic"],
            "instruments":[{"name":"Synth", "role":"Hook"}],"vocals":{"type":"Instrumental"},
            "production":{"texture":"Original cassette"},"summary":"Historical analysis"}}
        r=b.publish_payload(x,result,previous)
        self.assertEqual(r['bpm'],119.5)
        self.assertIn('Historical analysis',r['summary'])
        self.assertIn('Waveform SHA256',r['summary'])
        self.assertEqual(r['instruments'],previous['analysis']['instruments'])
        self.assertEqual(r['vocals'],previous['analysis']['vocals'])
        self.assertEqual(r['timeSignature'],'')

if __name__=='__main__': unittest.main()
