import dotenv from 'dotenv';
dotenv.config();
import { MongoClient } from 'mongodb';

async function run() {
    const client = new MongoClient(process.env.MONGODB_URI);
    await client.connect();
    const db = client.db('laluxurebot');
    const docs = await db.collection('sessions').find({}).toArray();
    for (const d of docs) {
        console.log("ID", d._id, "Keys Count", Object.keys(d.files).length, "Content Size", JSON.stringify(d.files).length);
    }
    process.exit(0);
}
run();
