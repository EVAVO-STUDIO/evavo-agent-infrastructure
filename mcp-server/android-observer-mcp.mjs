import { spawnSync } from "node:child_process";
import { join } from "node:path";
import process from "node:process";
import { createInterface } from "node:readline";

const GIT_ROOT = (process.env.EVAVO_GIT_ROOT ?? "C:\\GitRepos").trim();
const BRIDGE_ROOT = join(GIT_ROOT, "evavo-android-device-bridge");
const TARGET_REF = /^android-[a-f0-9]{16}$/u;
const PACKAGE = /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/u;
const MAX_OUTPUT = 2 * 1024 * 1024;

const readonly = Object.freeze({ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
const common = {
  targetRef: { type: "string", pattern: "^android-[a-f0-9]{16}$" },
  packageName: { type: "string", pattern: "^[A-Za-z][A-Za-z0-9_]*(?:\\.[A-Za-z][A-Za-z0-9_]*)+$" },
};
const TOOLS = Object.freeze([
  { name:"evavo_android_observer_usb",description:"Read privacy-safe Windows Samsung/Android/ADB/MTP USB visibility. No device mutation.",annotations:readonly,inputSchema:{type:"object",additionalProperties:false,properties:{}} },
  { name:"evavo_android_observer_bringup",description:"Read Android host readiness and privacy-safe device inventory/profile facts including physical/emulator class, API, ABI, BLE and observed GLES. No device mutation.",annotations:readonly,inputSchema:{type:"object",additionalProperties:false,properties:{}} },
  { name:"evavo_android_observer_profile",description:"Read one authorised Android device development profile by privacy-safe targetRef.",annotations:readonly,inputSchema:{type:"object",additionalProperties:false,required:["targetRef"],properties:{targetRef:common.targetRef}} },
  { name:"evavo_android_observer_app_status",description:"Read install/version/system-app/running state for one Android package.",annotations:readonly,inputSchema:{type:"object",additionalProperties:false,required:["targetRef","packageName"],properties:common} },
  { name:"evavo_android_observer_app_health",description:"Read package-scoped running, memory, display and orientation health without raw shell output or PID.",annotations:readonly,inputSchema:{type:"object",additionalProperties:false,required:["targetRef","packageName"],properties:common} },
  { name:"evavo_android_observer_app_diagnostics",description:"Read bounded fatal-exception, ANR and native-crash counts for one package without returning raw logcat.",annotations:readonly,inputSchema:{type:"object",additionalProperties:false,required:["targetRef","packageName"],properties:{...common,lines:{type:"integer",minimum:1,maximum:10000}}} },
]);

function asObject(value){if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("arguments must be an object");return value;}
function base(raw){const args=raw===undefined?{}:asObject(raw);const targetRef=String(args.targetRef??"").trim(),packageName=String(args.packageName??"").trim();if(!TARGET_REF.test(targetRef))throw new Error("invalid targetRef");if(!PACKAGE.test(packageName))throw new Error("invalid packageName");return{args,targetRef,packageName};}
function run(executable,args,timeoutMs=120000){const result=spawnSync(executable,args,{cwd:BRIDGE_ROOT,encoding:"utf8",shell:false,windowsHide:true,timeout:timeoutMs,maxBuffer:MAX_OUTPUT,env:process.env});if(result.error||result.status!==0)throw new Error("read-only Android observer command failed");const text=String(result.stdout??"").trim();let value;try{value=asObject(JSON.parse(text));}catch{throw new Error("read-only Android observer returned invalid JSON");}return{...value,observer:{schema:"evavo.android-observer.v1",readOnly:true,mutationAuthority:false,arbitraryShellAccepted:false,rawAdbSerialReturned:false,credentialsReturned:false,remotePublicListenerRequired:false}};}

async function callTool(name,raw){
  if(name==="evavo_android_observer_usb"){if(raw!==undefined&&Object.keys(asObject(raw)).length)throw new Error("USB observer accepts no arguments");return run("powershell.exe",["-NoLogo","-NoProfile","-NonInteractive","-ExecutionPolicy","Bypass","-File","scripts\\diagnose-windows-usb.ps1","-Json"],90000);}
  if(name==="evavo_android_observer_bringup"){if(raw!==undefined&&Object.keys(asObject(raw)).length)throw new Error("bring-up observer accepts no arguments");return run(process.execPath,["src\\bringup-cli.mjs","--json"],120000);}
  if(name==="evavo_android_observer_profile"){const args=asObject(raw),targetRef=String(args.targetRef??"").trim();if(!TARGET_REF.test(targetRef))throw new Error("invalid targetRef");return run(process.execPath,["src\\device-profile-cli.mjs","--target",targetRef,"--json"],90000);}
  const {args,targetRef,packageName}=base(raw);
  if(name==="evavo_android_observer_app_status")return run(process.execPath,["src\\app-lifecycle-cli.mjs","status","--target",targetRef,"--package",packageName,"--json"],90000);
  if(name==="evavo_android_observer_app_health")return run(process.execPath,["src\\app-health-cli.mjs","--target",targetRef,"--package",packageName,"--json"],120000);
  if(name==="evavo_android_observer_app_diagnostics"){const lines=args.lines===undefined?4000:Number(args.lines);if(!Number.isInteger(lines)||lines<1||lines>10000)throw new Error("invalid lines");return run(process.execPath,["src\\app-diagnostics-cli.mjs","--target",targetRef,"--package",packageName,"--lines",String(lines),"--json"],120000);}
  throw new Error(`unknown tool: ${name}`);
}

const result=(id,value)=>({jsonrpc:"2.0",id:id??null,result:value});
const error=(id,code,message)=>({jsonrpc:"2.0",id:id??null,error:{code,message}});
const input=createInterface({input:process.stdin,crlfDelay:Infinity});
const write=(value)=>process.stdout.write(`${JSON.stringify(value)}\n`);
for await(const line of input){
  if(!line.trim())continue;let request;
  try{request=JSON.parse(line);}catch{write(error(null,-32700,"Parse error"));continue;}
  if(request.jsonrpc!=="2.0"||typeof request.method!=="string"){write(error(request.id,-32600,"Invalid request"));continue;}
  try{
    if(request.method==="notifications/initialized")continue;
    if(request.method==="ping")write(result(request.id,{}));
    else if(request.method==="initialize")write(result(request.id,{protocolVersion:"2024-11-05",capabilities:{tools:{listChanged:false}},serverInfo:{name:"evavo-android-observer-mcp",version:"1.0.0"},instructions:"Read-only EVAVO Android workstation observer. Use it to inspect USB/ADB/device and installed-app health. It cannot install, uninstall, clear data, launch, stop, send input, create port mappings, run arbitrary shell, or mutate the Android device."}));
    else if(request.method==="tools/list")write(result(request.id,{tools:TOOLS}));
    else if(request.method==="tools/call"){const params=asObject(request.params),value=await callTool(String(params.name??""),params.arguments);write(result(request.id,{content:[{type:"text",text:JSON.stringify(value,null,2)}],isError:false}));}
    else write(error(request.id,-32601,"Method not found"));
  }catch(caught){const message=caught instanceof Error?caught.message:"Unknown error";write(result(request.id,{content:[{type:"text",text:JSON.stringify({ok:false,error:message,readOnly:true,mutationAuthority:false,rawAdbSerialReturned:false,credentialsReturned:false})}],isError:true}));}
}
