import 'dotenv/config';
import {connectDatabase,closeDatabase,databaseDriver} from '../db/connection.js';
import {migrateMongo} from '../db/migrateMongo.js';
if(databaseDriver!=='postgres')throw new Error('Set DB_DRIVER=postgres for the migration command');
try{
 await connectDatabase();const result=await migrateMongo({preflight:!process.argv.includes('--apply')});console.log(JSON.stringify(result));
}catch(error){console.error('Migration stopped:',error.status?error.message:'Check the target database, source freeze and private migration settings. No source records were removed.');process.exitCode=1;}
finally{await closeDatabase();}
