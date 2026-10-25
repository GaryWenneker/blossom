"""Deterministic tests: no external YouTube/MCP access and no downloads."""
import json
from pathlib import Path
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import autopilot as ap
import blossom_bridge as bridge

class AutopilotTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.entries = bridge.load_recs()

    def item(self, title, duration, channel='KLF'):
        return dict(title=title,duration_seconds=duration,channel=channel,video_id='HDsCeC6f0zc')

    def test_reject_wrong_1990_radio_edits(self):
        entry = self.entries[1]
        for title,dur in [
           ('The KLF - What Time Is Love? 1988 Pure Trance Original',425),
           ('The KLF - What Time Is Love Echo & The Bunnymen Remix',307),
           ('The KLF 3AM Eternal Live at the SSL',221)]:
            self.assertFalse(ap.classify(entry,self.item(title,dur))['eligible'])
        selected = ap.classify(entry,self.item('The KLF - What Time Is Love Live At Trancentral Radio Edit 1990',233))
        self.assertTrue(selected['eligible'])
        self.assertGreaterEqual(selected['score'],87)

    def test_2021_must_be_2021_and_not_12inch(self):
        entry=self.entries[3]
        self.assertFalse(ap.classify(entry,self.item('The KLF 3AM Eternal Live at the SSL',232))['eligible'])
        self.assertFalse(ap.classify(entry,self.item('3AM Eternal Live at SSL 2021 12 inch',355))['eligible'])
        self.assertTrue(ap.classify(entry,self.item('The KLF 3AM Eternal Live at SSL 2021 Solid State Logik',232))['eligible'])

    def test_distinguish_tammy_from_black_steel(self):
        entry=self.entries[7]
        self.assertFalse(ap.classify(entry,self.item('The KLF Justified and Ancient White Room Black Steel',305))['eligible'])
        self.assertTrue(ap.classify(entry,self.item('The KLF Tammy Wynette Justified and Ancient Stand By The Jams 1991',217))['eligible'])

    def test_doctorin_video_is_not_seven_inch(self):
        entry=self.entries[10]
        self.assertFalse(ap.classify(entry,self.item("Timelords Doctorin the Tardis official video",143))['eligible'])
        self.assertTrue(ap.classify(entry,self.item("Timelords Doctorin the Tardis radio edit 7inch",218))['eligible'])

    def test_chill_out_requires_original_1990(self):
        entry=self.entries[12]
        self.assertFalse(ap.classify(entry,self.item('The KLF Chill Out 45min',2700))['eligible'])
        self.assertFalse(ap.classify(entry,self.item('The KLF Chill Out Come Down Dawn full album 1990',2700))['eligible'])
        self.assertTrue(ap.classify(entry,self.item('The KLF Chill Out Original 1990 Full Album',2700))['eligible'])

    def test_hold_without_rights_and_without_downloading(self):
        entry=self.entries[0]
        cand=self.item('The KLF What Time Is Love Pure Trance 1988 Original',425)
        cand['url']='https://www.youtube.com/watch?v=HDsCeC6f0zc'
        cand['decision']=ap.classify(entry,cand)
        self.assertTrue(cand['decision']['eligible'])
        with tempfile.TemporaryDirectory() as d,patch.object(bridge,'RESULTS',Path(d)),\
             patch.object(ap,'metadata_search',return_value={'selected':cand,'candidates':[cand]}),\
             patch.object(bridge,'download_authorized',side_effect=AssertionError('download unexpectedly called')):
            state={'version':1,'recordings':{}}
            outcome=ap.run_one(entry,state,authorized_download=False,publish=False)
            self.assertEqual(outcome,'awaiting_download_authorization')
            self.assertEqual(state['recordings'][entry['slug']]['status'],'awaiting_download_authorization')

    def test_selection_saved_with_ranked_reasons(self):
        entry=self.entries[0]
        valid_title='The KLF What Time Is Love Pure Trance Original 1988'
        fake_response={"entries":[
            {"id":"AAAAAAAAAAA","title":"The KLF What Time Is Love Live At Trancentral 1990", "duration":233,"uploader":"KLF"},
            {"id":"BBBBBBBBBBB","title":valid_title,"duration":425,"uploader":"Archivist"},
        ]}
        with tempfile.TemporaryDirectory() as d,patch.object(bridge,'RESULTS',Path(d)),\
             patch.object(bridge,'run',return_value=SimpleNamespace(stdout=json.dumps(fake_response))):
            result=ap.metadata_search(entry)
            self.assertEqual(result['selected']['video_id'],'BBBBBBBBBBB')
            self.assertEqual(result['selection_result'],'auto_matched_metadata')
            self.assertTrue((Path(d)/f"{entry['slug']}_autopilot_candidates.json").is_file())

    def test_publish_is_not_silently_automatic(self):
        with self.assertRaisesRegex(RuntimeError, 'authorized-download'):
            ap.loop(SimpleNamespace(publish=True,authorized_download=False))

    def test_autopublish_label_not_falsely_human_confirmed(self):
        entry=self.entries[0]
        waveform={"audio_source_provenance":{"sha256":"testhash"},"audio_measurements":{
            "tempo":{"bpm":120.1,"confidence":"moderate (algorithmic)","agreement_fraction":.8},
            "duration_seconds":425,"tonality":{},"ebu_r128":{},"sample_peak_dbfs":-1}}
        payload=bridge.publish_payload(entry,waveform,{"analysis":{"confidence":.7}},auto_verified=True)
        self.assertIn("automatically matched",payload['summary'])
        self.assertNotIn("user-confirmed",payload['summary'])
        self.assertLessEqual(payload['confidence'],.58)

    def test_year_conflict_rejected(self):
        entry=self.entries[4]
        item=self.item('The KLF Last Train to Trancentral 1989 Pure Trance Original',405)
        self.assertFalse(ap.classify(entry,item)['eligible'])

if __name__=='__main__':unittest.main()
