import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { win32 as path } from "node:path";
import process from "node:process";
import { createInterface } from "node:readline";

const SERVER_NAME = "evavo-zero-cost-physical-acceptance";
const SERVER_VERSION = "1.1.0";
const REPOSITORY = "EVAVO-STUDIO/evavo-local-storage";
const LOCAL_APP_DATA = String(process.env.LOCALAPPDATA || "").trim();
const TOOL = Object.freeze({
  name:"evavo_zero_cost_physical_acceptance",
  description:"Run the fixed current-main zero-cost workstation convergence acceptance from a temporary exact-main Local Storage checkout. Accepts no executable, script, path, argv, shell text, provider mutation or business-task authority. Success proves the current Local Storage zero-cost generation, persistent automation watchdog and canonical Local Compute queue are physically converged on the same-user Windows workstation; it does not prove a separate business or GPU workload.",
  inputSchema:{type:"object",additionalProperties:false,properties:{}},
  annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:true,openWorldHint:false},
  _meta:{
    "io.evavo/effects":["local-recovery-convergence","physical-acceptance"],
    "io.evavo/repositoryIndependentManagedClone":true,
    "io.evavo/developerCheckoutMutationAllowed":false,
    "io.evavo/arbitraryCommandTextAccepted":false,
    "io.evavo/callerExecutableAccepted":false,
    "io.evavo/callerScriptPathAccepted":false,
    "io.evavo/callerArgvAccepted":false,
    "io.evavo/providerMutationAuthority":false,
    "io.evavo/businessTaskReplayAuthority":false,
    "io.evavo/administratorElevationAllowed":false,
    "io.evavo/githubActionsRequired":false,
    "io.evavo/vercelRequired":false,
    "io.evavo/paidComputeRequired":false,
  },
});

function lastJson(text){
  const lines=String(text||"").split(/\r?\n/u);
  for(let index=lines.length-1;index>=0;index-=1){
    if(!lines[index].trimStart().startsWith("{"))continue;
    try{const value=JSON.parse(lines.slice(index).join("\n").trim());if(value&&typeof value==="object"&&!Array.isArray(value))return value;}catch{}
  }
  return null;
}
function runFixed(executable,args,{cwd,timeout=300_000,maxBuffer=4*1024*1024}={}){
  const child=spawnSync(executable,args,{cwd,encoding:"utf8",windowsHide:true,shell:false,timeout,maxBuffer,env:{...process.env,GIT_TERMINAL_PROMPT:"0",GCM_INTERACTIVE:"Never",GH_PROMPT_DISABLED:"1",GIT_LFS_SKIP_SMUDGE:"1"}});
  if(child.error)throw new Error(`${executable} failed to start: ${child.error.message}`);
  if(child.status!==0)throw new Error(`${executable} exited ${String(child.status)}: ${String(child.stderr||child.stdout||"").slice(-2000)}`);
  return String(child.stdout||"").trim();
}
function runAcceptance(raw={}){
  if(!raw||typeof raw!=="object"||Array.isArray(raw)||Object.keys(raw).length!==0)throw new Error("physical acceptance accepts no arguments");
  if(process.platform!=="win32")throw new Error("physical acceptance requires Windows");
  if(!LOCAL_APP_DATA)throw new Error("LOCALAPPDATA is required");

  runFixed("gh.exe",["auth","status","--hostname","github.com"],{timeout:60_000});
  const onlineMain=runFixed("gh.exe",["api",`repos/${REPOSITORY}/commits/main`,"--jq",".sha"],{timeout:60_000}).toLowerCase();
  if(!/^[a-f0-9]{40}$/u.test(onlineMain))throw new Error("Local Storage online main SHA is invalid");

  const base=path.join(LOCAL_APP_DATA,"EVAVO","ZeroCostPhysicalAcceptanceMcp");
  mkdirSync(base,{recursive:true});
  const workspace=mkdtempSync(path.join(base,"run-"));
  let cleanupVerified=false;
  try{
    runFixed("gh.exe",["repo","clone",REPOSITORY,workspace,"--","--filter=blob:none","--no-tags","--single-branch","--branch","main"],{cwd:base,timeout:300_000});
    const head=runFixed("git.exe",["-C",workspace,"rev-parse","HEAD"],{timeout:30_000}).toLowerCase();
    const branch=runFixed("git.exe",["-C",workspace,"branch","--show-current"],{timeout:30_000});
    const dirty=runFixed("git.exe",["-C",workspace,"status","--porcelain=v1","--untracked-files=all"],{timeout:30_000});
    if(head!==onlineMain||branch!=="main"||dirty)throw new Error("temporary Local Storage checkout is not exact clean current main");

    const script=path.join(workspace,"scripts","Invoke-EvavoZeroCostPhysicalAcceptanceCurrent.ps1");
    if(!existsSync(script))throw new Error("fixed zero-cost physical acceptance helper is missing from current main");
    const output=runFixed("powershell.exe",[
      "-NoLogo","-NoProfile","-NonInteractive","-WindowStyle","Hidden","-ExecutionPolicy","Bypass","-File",script,
    ],{cwd:workspace,timeout:3_300_000,maxBuffer:4*1024*1024});
    const receipt=lastJson(output);
    if(!receipt)throw new Error("physical acceptance helper returned no successful structured receipt");
    if(
      Number(receipt.schemaVersion)!==1||
      receipt.kind!=="evavo-zero-cost-physical-acceptance-current-v1"||
      receipt.ok!==true||
      receipt.revision!==onlineMain||
      receipt.pythonVersion!=="3.12"||
      receipt.canonicalQueueHealthy!==true||
      receipt.persistentAutomationWatchdogHealthy!==true||
      receipt.acceptanceIsRecoveryAuthority!==false||
      receipt.arbitraryCommandTextAccepted!==false||
      receipt.sourceRepositoryMutationPerformed!==false||
      receipt.providerMutationPerformed!==false||
      receipt.administratorElevationPerformed!==false||
      receipt.githubActionsRequired!==false||
      receipt.selfHostedActionsRunnerRequired!==false||
      receipt.vercelRequired!==false||
      receipt.netlifyRequired!==false||
      receipt.paidComputeRequired!==false||
      receipt.credentialValuesReturned!==false||
      receipt.physicalPathsReturned!==false
    )throw new Error("physical acceptance receipt failed admission");
    const convergence=receipt.physicalConvergence;
    if(
      !convergence||
      convergence.kind!=="evavo-zero-cost-watchdog-physical-convergence-v1"||
      convergence.ok!==true||
      convergence.expectedRevision!==receipt.revision||
      convergence.sourceRevision!==receipt.revision||
      convergence.sourceExactCleanBoundMain!==true||
      convergence.powershellParsePassed!==true||
      convergence.bootstrapReceiptAccepted!==true||
      convergence.canonicalQueueRecoveryPassed!==true||
      convergence.liveStatusAccepted!==true||
      convergence.canonicalQueueHealthy!==true||
      convergence.persistentAutomationWatchdogHealthy!==true||
      convergence.persistentAutomationWatchdogProcessAlive!==true||
      convergence.persistentAutomationWatchdogExactPayloadRunning!==true||
      convergence.temporaryCloneOnly!==true||
      convergence.developerCheckoutMutated!==false||
      convergence.sourceRepositoryMutationPerformed!==false||
      convergence.providerMutationPerformed!==false||
      convergence.administratorElevationPerformed!==false||
      convergence.arbitraryTaskAuthority!==false||
      convergence.arbitraryCommandAuthority!==false||
      convergence.effectfulBusinessTaskReplay!==false||
      convergence.githubActionsRequired!==false||
      convergence.selfHostedActionsRunnerRequired!==false||
      convergence.vercelRequired!==false||
      convergence.netlifyRequired!==false||
      convergence.paidComputeRequired!==false||
      convergence.credentialValuesReturned!==false||
      convergence.physicalPathsReturned!==false||
      convergence.temporaryWorkspaceCleanupVerified!==true
    )throw new Error("physical convergence evidence failed admission");
    return{...receipt,invokedThrough:SERVER_NAME,repositoryIndependentManagedClone:true,developerCheckoutMutationAllowed:false,callerArgumentsAccepted:false,arbitraryCommandTextAccepted:false};
  }finally{
    try{rmSync(workspace,{recursive:true,force:true});cleanupVerified=!existsSync(workspace);}catch{cleanupVerified=false;}
    if(!cleanupVerified)throw new Error("temporary physical acceptance checkout cleanup was not verified");
  }
}
function send(id,result){process.stdout.write(`${JSON.stringify({jsonrpc:"2.0",id,result})}\n`);}
function sendError(id,code,message){process.stdout.write(`${JSON.stringify({jsonrpc:"2.0",id,error:{code,message}})}\n`);}

const input=createInterface({input:process.stdin,crlfDelay:Infinity});
input.on("line",line=>{
  if(!line.trim())return;
  let request;try{request=JSON.parse(line);}catch{return;}
  const id=request.id;
  try{
    if(request.method==="initialize"){send(id,{protocolVersion:request.params?.protocolVersion||"2025-03-26",capabilities:{tools:{}},serverInfo:{name:SERVER_NAME,version:SERVER_VERSION}});return;}
    if(request.method==="notifications/initialized")return;
    if(request.method==="ping"){send(id,{});return;}
    if(request.method==="tools/list"){send(id,{tools:[TOOL]});return;}
    if(request.method==="tools/call"){
      if(String(request.params?.name||"")!==TOOL.name)throw new Error("unknown tool");
      const value=runAcceptance(request.params?.arguments||{});
      send(id,{content:[{type:"text",text:JSON.stringify(value)}],structuredContent:value,isError:false});return;
    }
    sendError(id,-32601,`method not found: ${String(request.method||"")}`);
  }catch(error){
    if(request.method==="tools/call"){
      const payload={ok:false,kind:"evavo-zero-cost-physical-acceptance-error-v1",error:String(error?.message||error).slice(0,2000),retryUnderlyingAction:false,reconciliationRequired:false,repositoryIndependentManagedClone:true,developerCheckoutMutationAllowed:false,arbitraryCommandTextAccepted:false,providerMutationPerformed:false,githubActionsRequired:false,vercelRequired:false,paidComputeRequired:false};
      send(id,{content:[{type:"text",text:JSON.stringify(payload)}],structuredContent:payload,isError:true});
    }else sendError(id,-32000,String(error?.message||error).slice(0,2000));
  }
});
