import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import { studioView } from "../public/studio.js";
import { musicDnaView } from "../public/music-dna.js";

const execFileAsync=promisify(execFile);
const root=dirname(dirname(fileURLToPath(import.meta.url)));
const publicDir=join(root,"public");
const chrome=[
  process.env.CHROME_BIN,
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/opt/google/chrome/chrome",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
].find(path=>path&&existsSync(path));

test("Viewports use fixed application shell with bounded studio/data scrollers",async()=>{
  const css=await readFile(join(publicDir,"viewport.css"),"utf8");
  const html=await readFile(join(publicDir,"index.html"),"utf8");
  const app=await readFile(join(publicDir,"app.js"),"utf8");
  const studio=await readFile(join(publicDir,"studio.js"),"utf8");
  assert.match(html,/href="\/viewport\.css"/);
  assert.match(app,/document\.body\.dataset\.view=state\.tab/);
  assert.match(css,/html,body\{height:100%;width:100%;margin:0;overflow:hidden\}/);
  assert.match(css,/\.shell\{[^}]*height:100dvh/);
  assert.match(css,/\.studio-workspace\{[^}]*grid-template-rows:/);
  assert.match(css,/\.studio-columns\{[^}]*grid-template-columns:/);
  assert.match(css,/\.studio-bottom-pane\[hidden\]\{display:none!important\}/);
  assert.match(studio,/role="tablist"/);
  assert.match(studio,/role="tabpanel"/);
  assert.match(studio,/studio-bottom-tab/);
  assert.doesNotMatch(css,/\.studio-columns\{grid-template-columns:repeat\(2/);
});

function browserMeasure() {
  window.addEventListener("load",()=>{
    const shell=document.querySelector(".shell"),view=document.querySelector(".content");
    const cols=[...document.querySelectorAll(".studio-columns>.studio-panel")];
    const lower=document.querySelector(".studio-lower");
    const rows=cols.length===0||cols.every(panel=>Math.abs(panel.getBoundingClientRect().top-cols[0].getBoundingClientRect().top)<2);
    const bounded=!lower||lower.getBoundingClientRect().bottom<=innerHeight+2;
    const safeScroll=document.documentElement.scrollHeight<=innerHeight+2&&document.body.scrollHeight<=innerHeight+2;
    const bodyLocked=getComputedStyle(document.body).overflowY==="hidden";
    const shellFits=Math.abs(shell.getBoundingClientRect().height-innerHeight)<3;
    const viewFits=view.getBoundingClientRect().bottom<=innerHeight+2;
    const result=document.querySelector("#viewport-result");
    result.dataset.pass=String(rows&&bounded&&safeScroll&&bodyLocked&&shellFits&&viewFits);
    result.dataset.report=JSON.stringify({
      rows,bounded,safeScroll,bodyLocked,shellFits,viewFits,
      viewport:innerWidth+"x"+innerHeight,bodyScroll:document.body.scrollHeight,
      shellHeight:shell.getBoundingClientRect().height,
      viewBottom:Math.round(view.getBoundingClientRect().bottom),
      outputBottom:Math.round(lower?.getBoundingClientRect().bottom||0)
    });
  });
}

test("Rendered Studio and Music DNA stay inside viewport at desktop and mobile widths",async t=>{
  if(process.env.CI && process.env.BLOSSOM_BROWSER_LAYOUT_TEST==="false")
    return t.skip("Rendered Chromium checks run on Node 22 in CI; static layout tests run on all Node versions");
  if(!chrome){
    if(process.env.CI)assert.fail("CI must provide Chrome/Chromium for viewport checks");
    return t.skip("Chromium is not installed locally");
  }
  const dir=await mkdtemp(join(tmpdir(),"blossom-layout-"));
  try{
    const original=await readFile(join(publicDir,"index.html"),"utf8");
    const cssLinks=["styles.css","studio.css","music-dna.css","viewport.css"];
    const linkify=html=>cssLinks.reduce((text,name)=>text.replace('href="/'+name+'"','href="'+pathToFileURL(join(publicDir,name)).href+'"'),html);
    const project={
      id:"aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",title:"Still by Hand",
      article:"An original local-news-inspired story about craft and community. ".repeat(8),
      artistId:"",sourceUrl:"https://example.org/story",
      parameters:{
        sunoModel:"v6",genre:"Country Pop",additionalStyles:["Americana","Acoustic"],
        excludeStyles:["EDM"],vocalGender:"male",instrumental:false,maxMode:false,
        weirdness:22,styleInfluence:75,variety:40,personalize:false,
        durationPreset:"radio",targetSeconds:205,customInstructions:"",
        imagePrompt:"",artistPhotoPrompt:""
      },
      result:{concept:"An uplifting story of craft",moods:["Nostalgic","Hopeful"],
        lyrics:"[Verse 1]\n"+"Original poetic lines about the craft of building guitars.\n".repeat(12),
        titles:["Still by Hand","The River Road"],rationale:"Warm guitars and live drums"}
    };
    const views={
      studio:studioView({data:{studioProjects:[project],studioAssets:[],artists:[],
        genres:{country:["Country Pop"]},musicDnaProfiles:[],studioReferences:[],studioStatus:{}}}),
      "music-dna":musicDnaView({data:{musicDnaProfiles:Array.from({length:25},(_,index)=>({
        id:"ref-"+index,title:"Track "+index,artist:"Sample Band",
        analysisVersion:0,analysis:null
      })),musicDnaJobs:[]}})
    };
    for(const [name,markup] of Object.entries(views)){
      const html=linkify(original)
        .replace("<body>","<body data-view=\""+name+"\">")
        .replace('<main id="view" class="content"><div class="loading">Loading your label...</div></main>',
          '<main id="view" class="content">'+markup+'</main>')
        .replace('<script type="module" src="/app.js"></script>',
          '<style>#viewport-result{display:none!important}</style><output id="viewport-result"></output><script>('+browserMeasure.toString()+')();</script>');
      const path=join(dir,name+".html");
      await writeFile(path,html);
      for(const [width,height] of [[1671,943],[1440,900],[1130,740],[390,844]]){
        const {stdout}=await execFileAsync(chrome,[
          "--headless=new","--disable-gpu","--no-sandbox","--disable-dev-shm-usage",
          "--disable-extensions","--hide-scrollbars","--virtual-time-budget=1000",
          "--window-size="+width+","+height,"--dump-dom",pathToFileURL(path).href
        ],{timeout:35000,maxBuffer:8*1024*1024});
        const match=stdout.match(/<output id="viewport-result" data-pass="([^"]+)" data-report="([^"]+)"/);
        assert.ok(match,"No viewport measurement from Chromium: "+name+" "+width+"x"+height);
        assert.equal(match[1],"true",name+" "+width+"x"+height+" "+match[2].replaceAll("&quot;",'"'));
      }
    }
  } finally {await rm(dir,{recursive:true,force:true});}
});
