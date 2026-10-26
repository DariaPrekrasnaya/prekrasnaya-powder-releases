// Packaging only. App resources come from the same tested bundle as Windows.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {execFileSync,spawn}=require('node:child_process');
const root=process.cwd(),version=process.env.VERSION,arch=process.env.ARCH;
if(!/^\d+\.\d+\.\d+$/.test(version)||!['arm64','x64'].includes(arch))throw Error('Invalid build inputs');
const run=(file,args)=>execFileSync(file,args,{stdio:'inherit'});
const out=path.join(root,'output'),name=`Prekrasnaya-Powder-${version}-Mac-${arch}.dmg`;
function appPath(){return path.join(out,arch==='arm64'?'mac-arm64':'mac','Prekrasnaya Powder.app');}
async function smokeApp(bundle,smoke){
 fs.mkdirSync(smoke,{recursive:true});
 const child=spawn(path.join(bundle,'Contents/MacOS/Prekrasnaya Powder'),arch==='x64'?['--force-prefers-reduced-motion']:[],{env:{...process.env,COMPACT_SMOKE_OUTPUT:smoke},stdio:'inherit'});
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error('Widget smoke timed out'));},300000);child.on('error',e=>{clearTimeout(timer);reject(e);});child.on('exit',code=>{clearTimeout(timer);code===0?resolve():reject(Error('Widget exit '+code));});});
 const result=JSON.parse(fs.readFileSync(path.join(smoke,'desktop-smoke.json')));
 if(!result.ok)throw Error(JSON.stringify(result));return result;
}
async function main(){
 if(process.argv[2]==='prepare'){
  const pkg=JSON.parse(fs.readFileSync('application/package.json'));
  if(pkg.version!==version||pkg.name!=='spy-compact')throw Error('Wrong application bundle');
  // Rosetta's initial translation is slow. Only the opt-in QA helper gets longer waits;
  // all assertions and application behavior stay unchanged.
  if(arch==='x64'){
    const probe='application/desktop/smoke.cjs';
    fs.writeFileSync(probe,fs.readFileSync(probe,'utf8').replaceAll('Date.now()+10000','Date.now()+60000').replaceAll('Date.now()+20000','Date.now()+60000'));
  }
  fs.writeFileSync('mac-build.json',JSON.stringify({appId:'com.daria.spycompact',productName:'Prekrasnaya Powder',electronVersion:'44.9.1',directories:{output:out},files:['**/*'],asarUnpack:['media/**'],npmRebuild:false,mac:{identity:'-',hardenedRuntime:false,notarize:false,minimumSystemVersion:'13.0.0',category:'public.app-category.productivity'},publish:null},null,2));
 }else if(process.argv[2]==='test'){
  run('codesign',['--verify','--deep','--strict','--verbose=2',appPath()]);
  const binaryArch=execFileSync('lipo',['-archs',path.join(appPath(),'Contents/MacOS/Prekrasnaya Powder')],{encoding:'utf8'}).trim();
  if(binaryArch!==(arch==='x64'?'x86_64':'arm64'))throw Error('Wrong binary architecture: '+binaryArch);
  if(arch==='x64'&&process.arch==='arm64')run('/usr/bin/arch',['-x86_64','/usr/bin/true']);
  const smoke=path.join(root,'smoke'),result=await smokeApp(appPath(),smoke);
  fs.writeFileSync(`mac-check-${arch}.json`,JSON.stringify({version,arch,platform:process.platform,rendering:'native',testHostArch:process.arch,execution:arch===process.arch?'native':'Rosetta 2',signature:'ad-hoc (not Developer ID, not notarized)',...result},null,2));
  fs.copyFileSync(path.join(smoke,'desktop-preview.png'),`mac-preview-${arch}.png`);
  console.log(JSON.stringify(result));
 }else if(process.argv[2]==='finish'){
  const stage=path.join(root,'dmg-stage');fs.mkdirSync(stage);fs.cpSync(appPath(),path.join(stage,'Prekrasnaya Powder.app'),{recursive:true,dereference:false,verbatimSymlinks:true});fs.symlinkSync('/Applications',path.join(stage,'Applications'));
  run('codesign',['--verify','--deep','--strict',path.join(stage,'Prekrasnaya Powder.app')]);
  run('hdiutil',['create','-volname','Prekrasnaya Powder','-srcfolder',stage,'-ov','-format','UDZO',path.join(root,name)]);
  run('hdiutil',['verify',path.join(root,name)]);
  const mount=path.join(root,'mounted-dmg');fs.mkdirSync(mount);
  run('hdiutil',['attach','-readonly','-nobrowse','-mountpoint',mount,path.join(root,name)]);
  try{
   run('codesign',['--verify','--deep','--strict',path.join(mount,'Prekrasnaya Powder.app')]);
   await smokeApp(path.join(mount,'Prekrasnaya Powder.app'),path.join(root,'smoke-dmg'));
   const checkFile=`mac-check-${arch}.json`,check=JSON.parse(fs.readFileSync(checkFile));check.dmgLaunchChecked=true;fs.writeFileSync(checkFile,JSON.stringify(check,null,2));
  }finally{run('hdiutil',['detach',mount]);}
  const sha256=crypto.createHash('sha256').update(fs.readFileSync(name)).digest('hex');
  fs.writeFileSync(`mac-asset-${arch}.json`,JSON.stringify({name,sha256,size:fs.statSync(name).size,version,arch},null,2));
  run('gh',['release','upload',`v${version}`,name,`mac-asset-${arch}.json`,`mac-check-${arch}.json`,`mac-preview-${arch}.png`]);
 }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
