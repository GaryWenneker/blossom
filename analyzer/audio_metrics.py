#!/usr/bin/env python3
"""Blossom KLF audio measurements from user-supplied, locally accessible recordings.

No audio is downloaded, no copyrighted audio is redistributed, and nothing is
claimed to be a verified original pressing merely from its filename.
"""
from __future__ import annotations
import argparse, csv, hashlib, json, math, subprocess, re
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import numpy as np
import librosa
from scipy.signal import fftconvolve

SR = 11025
HOP = 256
WINDOW_SECONDS = 40
MAX_WINDOWS = 8

MAJ = np.array([6.35,2.23,3.48,2.33,4.38,4.09,2.52,5.19,2.39,3.66,2.29,2.88])
MIN = np.array([6.33,2.68,3.52,5.38,2.60,3.53,2.54,4.75,3.98,2.69,3.34,3.17])
NOTES = ['C','C#','D','Eb','E','F','F#','G','Ab','A','Bb','B']

def fround(x, d=2):
    if x is None: return None
    x = float(x)
    return round(x,d) if np.isfinite(x) else None

def sha256(path):
    h=hashlib.sha256()
    with path.open('rb') as f:
        for b in iter(lambda:f.read(1024*1024),b''):
            h.update(b)
    return h.hexdigest()

def probe(path):
    try:
        data = subprocess.check_output(['ffprobe','-v','error','-show_entries',
          'format=duration,format_name:stream=codec_name,sample_rate,channels',
          '-select_streams','a:0','-of','json',str(path)],timeout=30)
        return json.loads(data)
    except Exception as exc:
        return {'warning':str(exc)}

def windows(y,sr=SR):
    n=len(y)
    w=min(n,int(WINDOW_SECONDS*sr))
    if w==0: return []
    if n<=w: return [y]
    starts=np.linspace(0,max(0,n-w),MAX_WINDOWS,dtype=int)
    return [y[int(p):int(p+w)] for p in starts]

def tempo_estimate(y, sr=SR):
    """Correlation-based tempo candidates, not proof of human-perceived downbeat."""
    candid=[]
    for chunk in windows(y):
        onset=librosa.onset.onset_strength(y=chunk,sr=sr,hop_length=HOP)
        if onset.size<30: continue
        onset=np.nan_to_num(onset)
        variability=float(np.std(onset))
        if variability < 0.03 or (np.mean(onset)>0 and variability < np.mean(onset)*0.07):
            continue
        z=onset-np.mean(onset)
        ac=fftconvolve(z,z[::-1],mode='full')[len(z)-1:]
        lag_lo=max(1,int(round(60*sr/(180*HOP))))
        lag_hi=min(len(ac)-2,int(round(60*sr/(65*HOP))))
        if lag_hi<=lag_lo:continue
        series=ac[lag_lo:lag_hi+1]/(ac[0]+1e-9)
        idx=int(np.argmax(series))+lag_lo
        # Sub-frame interpolation avoids coarse ~4 BPM quantization at 120 BPM.
        if 1 <= idx < len(ac)-1:
            y_l,y_m,y_r = ac[idx-1],ac[idx],ac[idx+1]
            denom=y_l-2*y_m+y_r
            offset=np.clip(0.5*(y_l-y_r)/denom,-1,1) if abs(denom)>1e-12 else 0
        else: offset=0
        bp=60*sr/(HOP*(idx+offset))
        strength=float(max(0,ac[idx]/(ac[0]+1e-9)))
        if strength > 0.11: candid.append((bp,strength))
    if len(candid)<2:
        if len(candid)==1 and candid[0][1]>.35:
            b=candid[0][0]
            return {'bpm':fround(b,1),'confidence':'low (single window only)',
                    'window_consensus':1,'half_time_alternative_bpm':fround(b/2,1),
                    'double_time_alternative_bpm':fround(b*2,1),'candidates_bpm':[fround(b,1)]}
        return {'bpm':None,'confidence':'insufficient regular percussion','window_consensus':len(candid),
                'candidates_bpm':[fround(c[0]) for c in candid]}
    # The correlation may pick a half/double beat. Report estimated periodicity, not certainty.
    vals=np.array([b for b,s in candid]); weights=np.array([s for b,s in candid]);
    med=float(np.median(vals))
    good=(np.abs(vals-med)<med*0.08)
    if np.sum(good)>=2:
        med=float(np.average(vals[good],weights=weights[good]))
    consensus=float(np.mean(good))
    strength=float(np.mean(weights))
    if consensus<.55 or strength<.13:
        conf='low'
    elif consensus<.75 or strength<.3:
        conf='medium'
    else:
        conf='moderate (algorithmic)'
    return {'bpm':fround(med,1),'confidence':conf,'window_consensus':len(candid),
            'agreement_fraction':fround(consensus,3),'correlation_strength':fround(strength,3),
            'half_time_alternative_bpm':fround(med/2,1),
            'double_time_alternative_bpm':fround(med*2,1),
            'window_candidates_bpm':[fround(v,1) for v in vals]}

def key_estimate(y, sr=SR):
    """Krumhansl-Schmuckler template match; key estimates remain low-authority."""
    vectors=[]
    for chunk in windows(y):
        if float(np.max(np.abs(chunk)))<0.01:continue
        ch=librosa.feature.chroma_stft(y=chunk,sr=sr,hop_length=1024,n_fft=2048,
                                       tuning=0)
        vectors.append(np.median(ch,axis=1))
    if not vectors:return {'key':None,'confidence':'no tonal material'}
    v=np.median(np.array(vectors),axis=0)
    scores=[]
    for i in range(12):
        for scale,temp in [('major',MAJ),('minor',MIN)]:
            arr=np.roll(temp,i)
            corr=float(np.corrcoef(v,arr)[0,1])
            if np.isfinite(corr): scores.append((corr,f'{NOTES[i]} {scale}'))
    if len(scores)<2:return {'key':None,'confidence':'unable to resolve'}
    scores.sort(reverse=True)
    gap=scores[0][0]-scores[1][0]
    # Deliberately conservative: close alternate keys must stay unresolved.
    reliable=(scores[0][0]>=.70 and gap>=.10)
    return {'key':scores[0][1] if reliable else None,
      'tentative_key':scores[0][1],
      'runner_up':scores[1][1],
      'template_correlation':fround(scores[0][0],3),
      'separation_to_runner_up':fround(gap,3),
      'confidence':'tentative, algorithmic' if reliable else 'uncertain / not reported'}

def energy_and_transitions(y,sr=SR):
    # One-second energy features on decoded waveform. NOT segmentation by song section.
    step=sr
    n=len(y)//step
    if n<2:return {'rms_dbfs_median':None,'dynamic_spread_db':None,'energy_change_candidates_seconds':[]}
    a=y[:n*step].reshape(n,step).astype('float64')
    rms=np.sqrt(np.mean(a*a,axis=1))
    db=20*np.log10(rms+1e-9)
    median=float(np.median(db))
    spread=float(np.percentile(db,90)-np.percentile(db,10))
    win=8
    sm=np.convolve(db,np.ones(win)/win,mode='same')
    changes=[]
    for t in range(2*win,n-2*win):
        left=np.mean(sm[t-win:t]);right=np.mean(sm[t:t+win])
        delta=right-left
        if abs(delta)>5.5 and all(abs(t-s['time_seconds'])>13 for s in changes):
            changes.append({'time_seconds':int(t),'change_db':fround(delta,1)})
    changes=sorted(changes,key=lambda d:abs(d['change_db']),reverse=True)[:16]
    return {'rms_dbfs_median':fround(median),
            'dynamic_spread_db_p90_p10':fround(spread),
            'energy_change_candidates_seconds':sorted(changes,key=lambda d:d['time_seconds']),
            'energy_change_note':'Energy-based candidate changes only; they are NOT verified verse/chorus timestamps.'}

def integrated_loudness_ffmpeg(path):
    """Calculate integrated R128 loudness and LRA using FFmpeg, if available."""
    try:
        cp=subprocess.run(['ffmpeg','-hide_banner','-nostats','-loglevel','info',
          '-i',str(path),'-filter_complex','ebur128=peak=true:framelog=verbose',
          '-f','null','-'],stdout=subprocess.DEVNULL,stderr=subprocess.PIPE,
          text=True,timeout=240)
        if cp.returncode: return {'warning':'ffmpeg ebur128 failed'}
        summary=cp.stderr.rsplit('Summary:',1)[-1]
        def extract(pattern):
            m=re.search(pattern,summary,re.I|re.S)
            return fround(float(m.group(1))) if m else None
        return {'integrated_lufs':extract(r'Integrated loudness:.*?\bI:\s*([-+]?\d+(?:\.\d+)?)\s*LUFS'),
                'loudness_range_lu':extract(r'Loudness range:.*?\bLRA:\s*([-+]?\d+(?:\.\d+)?)\s*LU'),
                'peak_dbfs_ffmpeg':extract(r'True peak:.*?\bPeak:\s*([-+]?\d+(?:\.\d+)?)\s*dBFS')}
    except Exception as exc:
        return {'warning':str(exc)}

def analyze_track(path, entry):
    path=Path(path)
    meta=probe(path)
    y,sr=librosa.load(path,sr=SR,mono=False,dtype=np.float32)
    if y.ndim==2:
        mono=np.mean(y,axis=0)
        if len(y[0])>=1000:
            indices=np.linspace(0,len(y[0])-1,min(100000,len(y[0])),dtype=np.int64)
            x1,y1=y[0,indices],y[1,indices]
            stereo_corr=fround(np.corrcoef(x1,y1)[0,1],4) if np.std(x1)>0 and np.std(y1)>0 else None
        else:stereo_corr=None
        channels=y.shape[0]
    else:mono=y;channels=1;stereo_corr=None
    duration=len(mono)/SR
    if duration<2:raise ValueError('Less than 2 seconds of audio')
    sample_peak_db=20*math.log10(max(1e-9,float(np.max(np.abs(y)))))
    en=energy_and_transitions(mono)
    onset=tempo_estimate(mono)
    key=key_estimate(mono)
    lufs=integrated_loudness_ffmpeg(path)
    return {'reference':entry,
      'audio_source_provenance':{'file':str(path),'sha256':sha256(path),
        'verified_identity':'NOT AUTOMATICALLY VERIFIED — manually match master/edition against release metadata',
        'measurement_date_utc':datetime.now(timezone.utc).isoformat(),
        'analysis_method':'local waveform analysis: ffprobe/librosa/numpy/scipy; no neural listening',
        'ffprobe':meta},
      'audio_measurements':{'duration_seconds':fround(duration,3),'decoded_sample_rate_hz':SR,
        'channels':channels,'sample_peak_dbfs':fround(sample_peak_db),
        'stereo_left_right_correlation':stereo_corr,
        'tempo':onset,'tonality':key,'ebu_r128':lufs,**en},
      'not_measured':['vocal source separation','instrument classification','lyrics','song section names',
        'precise downbeat grid or time signature'],
      'warning':'Audio measured is only the file provided; preview clips and alternate edits cannot be treated as original release masters.'}

def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--manifest',default='recordings.json')
    ap.add_argument('--audio-dir',default='audio')
    ap.add_argument('--output-dir',default='results')
    args=ap.parse_args()
    manifest=json.loads(Path(args.manifest).read_text(encoding='utf-8'))
    out=Path(args.output_dir);out.mkdir(parents=True,exist_ok=True)
    aud=Path(args.audio_dir)
    rows=[];missing=[];done=[]
    for x in manifest['recordings']:
        p=aud/x['filename']
        if not p.is_file():
            missing.append({'id':x['blossom_id'],'title':x['title'],'expected_path':str(p)})
            print('MISSING:',p)
            continue
        try:
            result=analyze_track(p,x)
            (out/(x['slug']+'.json')).write_text(json.dumps(result,indent=2,ensure_ascii=False),encoding='utf-8')
            m=result['audio_measurements']; done.append(result)
            rows.append({'blossom_id':x['blossom_id'],'title':x['title'],
              'duration_seconds':m['duration_seconds'],'bpm_estimate':m['tempo']['bpm'],
              'bpm_confidence':m['tempo']['confidence'],
              'key_estimate':m['tonality']['key'],
              'key_candidate':m['tonality'].get('tentative_key'),
              'sample_peak_dbfs':m['sample_peak_dbfs'],
              'integrated_lufs':m['ebu_r128'].get('integrated_lufs'),
              'loudness_range_lu':m['ebu_r128'].get('loudness_range_lu'),
              'dynamic_spread_db':m['dynamic_spread_db_p90_p10'],
              'sha256':result['audio_source_provenance']['sha256']})
            print('MEASURED:',x['title'])
        except Exception as exc:
            missing.append({'id':x['blossom_id'],'title':x['title'],'error':str(exc)})
            print('ERROR:',x['title'],str(exc))
    if rows:
        with (out/'summary.csv').open('w',newline='',encoding='utf-8') as f:
            w=csv.DictWriter(f,fieldnames=list(rows[0]));w.writeheader();w.writerows(rows)
    status={'measured':len(done),'unavailable_or_failed':len(missing),
      'measurement_notice':'Results are analysis of locally provided recordings; source identity must be verified against specific issue.',
      'missing':missing}
    (out/'analysis_status.json').write_text(json.dumps(status,indent=2,ensure_ascii=False),encoding='utf-8')
    print(json.dumps({'measured':len(done),'missing_or_errors':len(missing),'output_directory':str(out)},indent=2))

if __name__=='__main__': main()
