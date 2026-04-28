import dotenv from 'dotenv';
dotenv.config();
import { connectMongo, restoreAllSessions } from './src/utils/mongostore.js';

async function run() {
    await connectMongo();
    await restoreAllSessions('./test_sessions');
    process.exit(0);
}
run();
