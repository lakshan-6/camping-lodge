import {PGlite} from '@electric-sql/pglite';
import {connectTestDatabase,closeDatabase} from '../../db/connection.js';
export async function testDatabase(){
 for(const key of Object.keys(process.env))if(key.startsWith('BACKUP_S3_'))delete process.env[key];
 await connectTestDatabase(new PGlite());
 return closeDatabase;
}
