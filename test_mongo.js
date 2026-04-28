import dotenv from 'dotenv';
dotenv.config();
import { connectMongo, listSessionsMongo, saveSessionMongo } from './src/utils/mongostore.js';

async function run() {
    console.log("MONGODB_URI:", process.env.MONGODB_URI ? "Set" : "Not Set");
    const ok = await connectMongo();
    console.log("Connect OK?", ok);
    if (!ok) return process.exit(1);

    const list = await listSessionsMongo();
    console.log("Sessions DB Count:", list.length);
    console.log("Session DB items:", list);
    
    process.exit(0);
}
run();
