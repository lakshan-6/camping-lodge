import mongoose from 'mongoose';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname,resolve,basename} from 'node:path';
import net from 'node:net';
import {once} from 'node:events';
export async function testDatabase(){
 const temp=await mkdtemp(join(tmpdir(),'camping-lodge-workflow-test-')),listener=net.createServer();listener.listen(0,'127.0.0.1');await once(listener,'listening');const port=listener.address().port;await new Promise(r=>listener.close(r));
 const child=spawn(process.env.TEST_MONGOD_PATH,['--dbpath',temp,'--port',String(port),'--bind_ip','127.0.0.1','--replSet','workflowTest','--logpath',join(temp,'mongod.log')],{windowsHide:true,stdio:'ignore'});let failure;child.on('error',e=>failure=e);
 const uri=`mongodb://127.0.0.1:${port}/workflow_test?directConnection=true`,client=new mongoose.mongo.MongoClient(uri,{serverSelectionTimeoutMS:500});
 const cleanup=async()=>{await mongoose.disconnect();await client.close();child.kill();if(child.exitCode===null)await once(child,'exit');if(dirname(resolve(temp))!==resolve(tmpdir())||!basename(temp).startsWith('camping-lodge-workflow-test-'))throw new Error('Unsafe test cleanup path');await rm(temp,{recursive:true,force:true});};
 try{let connected=false;for(let n=0;n<100;n++){if(failure)throw failure;try{await client.connect();connected=true;break;}catch{await new Promise(r=>setTimeout(r,100));}}if(!connected)throw new Error('Test MongoDB did not start');await client.db('admin').command({replSetInitiate:{_id:'workflowTest',members:[{_id:0,host:`127.0.0.1:${port}`}]}});for(let n=0;n<100;n++){if((await client.db('admin').command({hello:1})).isWritablePrimary)break;await new Promise(r=>setTimeout(r,100));}await mongoose.connect(uri);await Promise.all(Object.values(mongoose.models).map(m=>m.init()));return cleanup;}catch(e){await cleanup();throw e;}
}
