import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
export const root = path.resolve(process.env.DSH_ASSISTANT_STATE_DIR || path.join(os.homedir(), '.codex', 'dsh-assistant'));
export async function prepare() {await fs.mkdir(root,{recursive:true});}
export function validId(id) {if(typeof id!=='string'||!/^[A-Za-z0-9_-]+$/.test(id)) throw Error('Invalid task id'); return id;}
