import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";
import { createInterface } from "node:readline";

const REST_BASE = "http://127.0.0.1:4329";
const LOCAL_APP_DATA = (process.env.LOCALAPPDATA ?? "").trim();
const TYPED_ACTIONS = Object.freeze([
  "local-first-status","local-execution-readiness","local-execution-self-test",
  "secondary-recovery-status","repository-estate-audit","repository-estate-safe-sync",
  "workstation-acceptance",
]);
const READ_ROOTS = Object.freeze(["gitrepos","downloads","beestation","temp"]);
const WRITE_ROOTS = Object.freeze(["downloads","beestation","temp"]);
const OPERATOR_TYPES = Object.freeze(["powershell","python","bash","cmd"]);

const TOOLS = Object.freeze([
  { name:"evavo_local_agent_capabilities", description:"Read the self-hash-bound Local Agent capability projection. Performs no execution or external network activity.", inputSchema:{type:"object",additionalProperties:false,properties:{}} },
  { name:"evavo_local_agent_action", description:"Run one fixed receiver-owned Local Storage action through authenticated loopback REST. No caller executable, script, path or argv is accepted.", inputSchema:{type:"object",additionalProperties:false,required:["action"],properties:{action:{enum:[...TYPED_ACTIONS]}}} },
  { name:"evavo_local_file_list", description:"List bounded non-recursive metadata under one admitted Local Storage root. Returns no physical root paths.", inputSchema:{type:"object",additionalProperties:false,required:["root","path"],properties:{root:{enum:[...READ_ROOTS]},path:{type:"string",minLength:1,maxLength:4096},limit:{type:"integer",minimum:1,maximum:1000}}} },
  { name:"evavo_local_file_copy", description:"Copy one regular file locally with create-only destination and destination SHA-256 verification. GitRepos may be a source but never a normal-token destination.", inputSchema:{type:"object",additionalProperties:false,required:["sourceRoot","sourcePath","destinationRoot","destinationPath"],properties:{sourceRoot:{enum:[...READ_ROOTS]},sourcePath:{type:"string",minLength:1,maxLength:4096},destinationRoot:{enum:[...WRITE_ROOTS]},destinationPath:{type:"string",minLength:1,maxLength:4096}}} },
  { name:"evavo_local_operator_execute", description:"Execute PowerShell, Python, Bash or CMD through the separately enabled Local Agent operator lane. This is full interactive-user authority and has no durable fallback or automatic retry.", inputSchema:{type:"object",additionalProperties:false,required:["commandType","command"],properties:{commandType:{enum:[...OPERATOR_TYPES]},command:{type:"string",minLength:1,maxLength:32768},cwdRoot:{enum:[...READ_ROOTS]},cwdRelative:{type:"string",minLength:1,maxLength:4096},timeoutSeconds:{type:"integer",minimum:1,maximum:300}}} },
]);

function asObject(value){if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("arguments must be an object");return value;}
function includes(values,value){return values.includes(value);}
function sha256Text(value){return createHash("sha256").update(value,"utf8").digest("hex");}
async function readJsonFile(file,min,max){const s=await lstat(file);if(!s.isFile()||s.isSymbolicLink()||s.size<min||s.size>max)throw new Error("local projection failed file admission");return asObject(JSON.parse(await readFile(file,"utf8")));}

async function loadTypedToken(){
  if(!LOCAL_APP_DATA)throw new Error("LOCALAPPDATA is required");
  try{
    const doc=await readJsonFile(join(LOCAL_APP_DATA,"EVAVO","LocalAgentRest043","client-token.json"),32,8192);
    const token=typeof doc.token==="string"?doc.token.trim():"";
    if(doc.schemaVersion===1&&doc.kind==="evavo-local-agent-rest-client-credential-v1"&&token.length>=32)return{token,source:"same-user-credential-projection"};
  }catch{}
  const token=(process.env.EVAVO_LOCAL_AGENT_REST_TOKEN??"").trim();
  if(token.length<32)throw new Error("typed Local Agent credential is unavailable");
  return{token,source:"process-environment"};
}

async function loadOperatorToken(){
  if(!LOCAL_APP_DATA)throw new Error("LOCALAPPDATA is required");
  try{
    const doc=await readJsonFile(join(LOCAL_APP_DATA,"EVAVO","LocalAgentRest043","operator-token.json"),32,8192);
    const token=typeof doc.token==="string"?doc.token.trim():"";
    if(doc.schemaVersion===1&&doc.kind==="evavo-local-agent-rest-operator-credential-v1"&&doc.operatorExecEnabled===true&&token.length>=32)return{token,source:"same-user-operator-credential-projection"};
  }catch{}
  if((process.env.EVAVO_LOCAL_AGENT_REST_OPERATOR_EXEC??"").trim()!=="1")throw new Error("Local Agent operator execution is not explicitly enabled");
  const token=(process.env.EVAVO_LOCAL_AGENT_REST_OPERATOR_TOKEN??"").trim();
  if(token.length<32)throw new Error("Local Agent operator credential is unavailable");
  return{token,source:"process-environment"};
}

async function loadCapabilities(){
  if(!LOCAL_APP_DATA)throw new Error("LOCALAPPDATA is required");
  const projection=await readJsonFile(join(LOCAL_APP_DATA,"EVAVO","LocalAgentRest043","capabilities.json"),2,262144);
  const manifestText=typeof projection.manifestText==="string"?projection.manifestText:"";
  const manifestTextSha256=typeof projection.manifestTextSha256==="string"?projection.manifestTextSha256:"";
  if(projection.schemaVersion!==1||projection.kind!=="evavo-local-agent-capability-projection-043-v1"||!/^[a-f0-9]{64}$/.test(String(projection.sourceSha256??""))||!/^[a-f0-9]{64}$/.test(manifestTextSha256)||!manifestText||sha256Text(manifestText)!==manifestTextSha256)throw new Error("Local Agent capability projection integrity failed");
  const manifest=asObject(JSON.parse(manifestText));const normal=asObject(manifest.normalAutomation);const files=asObject(manifest.fileAuthority);const safety=asObject(manifest.safety);
  if(manifest.schemaVersion!==1||manifest.kind!=="evavo-local-agent-capabilities-043-v1"||manifest.mode!=="local-worker-first"||normal.arbitraryShellAuthority!==false||normal.providerMutationAuthority!==false||files.gitReposWriteAllowed!==false||files.permanentDeleteAllowed!==false||safety.githubActionsRequired!==false||safety.forcePush!==false||safety.resetHard!==false||safety.gitClean!==false||safety.permanentDelete!==false)throw new Error("Local Agent capability projection authority admission failed");
  return{schemaVersion:1,kind:"evavo-agent-infrastructure-local-capabilities-v1",ok:true,mode:manifest.mode,typedActions:normal.actions,transports:normal.transports,fileAuthority:files,operatorExecution:manifest.operatorExecution,bootstrap:manifest.bootstrap,projectionSelfHashVerified:true,externalNetworkPerformed:false,credentialValuesReturned:false,physicalPathsReturned:false};
}

async function postJson(path,payload,token,timeoutMs){
  let response;try{response=await fetch(`${REST_BASE}${path}`,{method:"POST",headers:{"Content-Type":"application/json","X-EVAVO-Local-Agent-Token":token},body:JSON.stringify(payload),signal:AbortSignal.timeout(timeoutMs),cache:"no-store"});}catch{throw new Error("Local Agent REST request did not return; execution outcome may be unknown and was not retried");}
  let body;try{body=await response.json();}catch{throw new Error("Local Agent REST returned invalid JSON; request was not retried");}
  const doc=asObject(body);if(!response.ok)throw new Error(`Local Agent REST rejected the request (${response.status}): ${String(doc.error??"unknown error")}`);return doc;
}

async function callTool(name,raw){
  const args=raw===undefined?{}:asObject(raw);
  if(name==="evavo_local_agent_capabilities")return loadCapabilities();
  if(name==="evavo_local_agent_action"){
    const action=String(args.action??"");if(!includes(TYPED_ACTIONS,action))throw new Error("action is not allowed");const credential=await loadTypedToken();
    const wait=action==="repository-estate-safe-sync"?7200:action==="repository-estate-audit"?3600:action==="workstation-acceptance"?1800:action==="local-execution-self-test"?300:180;
    const doc=await postJson("/v1/action",{action},credential.token,(wait+15)*1000);if(doc.kind!=="evavo-local-agent-rest-action-result-v1"||doc.action!==action)throw new Error("typed action result identity mismatch");return{...doc,credentialSource:credential.source,loopbackOnly:true,externalNetworkPerformedByMcp:false,credentialValuesReturned:false};
  }
  if(name==="evavo_local_file_list"){
    const root=String(args.root??""),path=String(args.path??""),limit=args.limit===undefined?250:Number(args.limit);if(!includes(READ_ROOTS,root)||!path||path.length>4096||!Number.isInteger(limit)||limit<1||limit>1000)throw new Error("file-list arguments are invalid");const credential=await loadTypedToken();const doc=await postJson("/v1/files/list",{root,path,limit},credential.token,15000);if(doc.kind!=="evavo-local-agent-rest-file-list-v1"||doc.recursive!==false||doc.physicalPathsReturned!==false)throw new Error("file list result identity mismatch");return{...doc,credentialSource:credential.source,externalNetworkPerformedByMcp:false};
  }
  if(name==="evavo_local_file_copy"){
    const sourceRoot=String(args.sourceRoot??""),destinationRoot=String(args.destinationRoot??""),sourcePath=String(args.sourcePath??""),destinationPath=String(args.destinationPath??"");if(!includes(READ_ROOTS,sourceRoot)||!includes(WRITE_ROOTS,destinationRoot)||!sourcePath||!destinationPath||sourcePath.length>4096||destinationPath.length>4096)throw new Error("file-copy arguments are invalid");const credential=await loadTypedToken();const doc=await postJson("/v1/files/copy",{sourceRoot,sourcePath,destinationRoot,destinationPath},credential.token,7215000);if(doc.kind!=="evavo-local-agent-rest-file-copy-v1"||doc.createOnly!==true||doc.destinationHashVerified!==true||doc.gitReposWriteAllowed!==false)throw new Error("file copy result identity mismatch");return{...doc,credentialSource:credential.source,externalNetworkPerformedByMcp:false};
  }
  if(name==="evavo_local_operator_execute"){
    const commandType=String(args.commandType??""),command=String(args.command??""),cwdRoot=String(args.cwdRoot??"gitrepos"),cwdRelative=String(args.cwdRelative??"."),timeout=args.timeoutSeconds===undefined?120:Number(args.timeoutSeconds);if(!includes(OPERATOR_TYPES,commandType)||!command||command.length>32768||!includes(READ_ROOTS,cwdRoot)||!cwdRelative||cwdRelative.length>4096||!Number.isInteger(timeout)||timeout<1||timeout>300)throw new Error("operator arguments are invalid");const credential=await loadOperatorToken();const doc=await postJson("/v1/operator/execute",{commandType,command,cwdRoot,cwdRelative,timeoutSeconds:timeout},credential.token,(timeout+15)*1000);if(doc.kind!=="evavo-local-agent-rest-operator-exec-v1"||doc.operatorAuthority!==true||doc.shellParameterUsed!==false)throw new Error("operator result identity mismatch");return{...doc,credentialSource:credential.source,loopbackOnly:true,externalNetworkPerformedByMcp:false,credentialValuesReturned:false};
  }
  throw new Error(`unknown tool: ${name}`);
}

const result=(id,value)=>({jsonrpc:"2.0",id:id??null,result:value});const error=(id,code,message)=>({jsonrpc:"2.0",id:id??null,error:{code,message}});
const input=createInterface({input:process.stdin,crlfDelay:Infinity});const write=(value)=>process.stdout.write(`${JSON.stringify(value)}\n`);
for await(const line of input){if(!line.trim())continue;let request;try{request=JSON.parse(line);}catch{write(error(null,-32700,"Parse error"));continue;}if(request.jsonrpc!=="2.0"||typeof request.method!=="string"){write(error(request.id,-32600,"Invalid request"));continue;}try{if(request.method==="notifications/initialized")continue;if(request.method==="ping")write(result(request.id,{}));else if(request.method==="initialize")write(result(request.id,{protocolVersion:"2024-11-05",capabilities:{tools:{listChanged:false}},serverInfo:{name:"evavo-agent-mcp",version:"1.1.0"}}));else if(request.method==="tools/list")write(result(request.id,{tools:TOOLS}));else if(request.method==="tools/call"){const params=asObject(request.params);const value=await callTool(String(params.name??""),params.arguments);write(result(request.id,{content:[{type:"text",text:JSON.stringify(value,null,2)}],isError:false}));}else write(error(request.id,-32601,"Method not found"));}catch(caught){const message=caught instanceof Error?caught.message:"Unknown error";write(result(request.id,{content:[{type:"text",text:JSON.stringify({ok:false,error:message,credentialValuesReturned:false,physicalPathsReturned:false})}],isError:true}));}}
