import test from 'node:test';
import assert from 'node:assert/strict';
import {api,getToken,setToken} from '../../client/src/api.js';

test('client API preserves sessions across temporary failures and bounds only read requests',async t=>{
 const globals=['fetch','localStorage','location'];
 const original=Object.fromEntries(globals.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
 const storage=new Map();
 let reloads=0,calls=[];
 Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{
  getItem:key=>storage.get(key)??null,
  setItem:(key,value)=>storage.set(key,String(value)),
  removeItem:key=>storage.delete(key),
 }});
 Object.defineProperty(globalThis,'location',{configurable:true,value:{reload:()=>{reloads++;}}});
 let response=()=>Response.json({ok:true});
 Object.defineProperty(globalThis,'fetch',{configurable:true,writable:true,value:async(url,options)=>{
  calls.push({url,options});
  return response(url,options);
 }});
 t.after(()=>{
  for(const key of globals){
   if(original[key])Object.defineProperty(globalThis,key,original[key]);
   else delete globalThis[key];
  }
 });
 function reset(){
  setToken('saved-session-token');
  reloads=0;calls=[];
 }

 await t.test('503 during account reads remains distinguishable and retains the saved session',async()=>{
  reset();
  response=()=>Response.json({error:'Sign-in service is temporarily unavailable.'},{status:503});
  await assert.rejects(api('/auth/me'),error=>error.status===503&&/temporarily unavailable/.test(error.message));
  assert.equal(getToken(),'saved-session-token');
  assert.equal(reloads,0);
  assert.equal(calls.length,1);
  assert.equal(calls[0].options.headers.Authorization,'Bearer saved-session-token');
 });

 await t.test('unauthorized operational requests clear tokens while auth routes leave the decision to their caller',async()=>{
  response=()=>Response.json({error:'Please log in'},{status:401});
  for(const path of ['/auth/me','/auth/login']){
   reset();
   await assert.rejects(api(path),error=>error.status===401);
   assert.equal(getToken(),'saved-session-token');
   assert.equal(reloads,0);
  }
  reset();
  await assert.rejects(api('/orders'),error=>error.status===401);
  assert.equal(getToken(),null);
  assert.equal(reloads,1);
 });

 await t.test('network failures and invalid successful JSON never replace the saved session with empty data',async()=>{
  reset();
  response=()=>{throw new TypeError('Failed to fetch');};
  await assert.rejects(api('/auth/me'),error=>error.status===0);
  for(const payload of ['<html>Service is starting</html>','null','']){
   response=()=>new Response(payload,{status:200});
   await assert.rejects(api('/auth/me'),error=>error.status===502);
  }
  assert.equal(getToken(),'saved-session-token');
  assert.equal(reloads,0);
  assert.equal(calls.length,4);
 });

 await t.test('a read timeout aborts once and strips the local timeout setting from fetch',async()=>{
  reset();
  response=(url,options)=>new Promise((resolve,reject)=>{
   options.signal.addEventListener('abort',()=>reject(new DOMException('Read timed out','AbortError')),{once:true});
  });
  await assert.rejects(api('/auth/status',{timeoutMs:10}),error=>error.status===0);
  assert.equal(calls.length,1);
  assert.equal(calls[0].options.signal.aborted,true);
  assert.equal('timeoutMs' in calls[0].options,false);
  assert.equal(getToken(),'saved-session-token');
  assert.equal(reloads,0);
 });

 await t.test('writes are sent once without a read timeout and report an uncertain save on network failure',async()=>{
  reset();
  response=()=>{throw new TypeError('Connection interrupted');};
  await assert.rejects(api('/orders',{method:'POST',timeoutMs:10,body:{requestId:'keep-on-retry'}}),
   error=>error.status===0&&/check|saved|completed/i.test(error.message));
  assert.equal(calls.length,1);
  assert.equal(calls[0].options.signal,undefined);
  assert.equal(calls[0].options.body,JSON.stringify({requestId:'keep-on-retry'}));
  assert.equal('timeoutMs' in calls[0].options,false);
  assert.equal(getToken(),'saved-session-token');
  assert.equal(reloads,0);
 });
});
