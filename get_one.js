import dotenv from 'dotenv';
dotenv.config();
import { MongoClient } from 'mongodb';

async function run() {
    const client = new MongoClient(process.env.MONGODB_URI);
    await client.connect();
    const db = client.db('laluxurebot');
    const doc = await db.collection('sessions').findOne({}, { projection: { _id:1, "files": 1 } });
    if(doc){
        console.log("ID", doc._id, "Keys", Object.keys(doc.files).length);
        console.log("JSON Length", JSON.stringify(doc.files).length);
    }else {console.log("No doc");}
    process.exit(0);
}
run();
