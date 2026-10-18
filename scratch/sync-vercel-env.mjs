import fs from 'node:fs';
import path from 'node:path';

async function main() {
  const candidates = [
    path.join(process.env.APPDATA, 'com.vercel.cli', 'Data', 'auth.json'),
    path.join(process.env.APPDATA, 'xdg.data', 'com.vercel.cli', 'auth.json'),
    path.join(process.env.APPDATA, 'com.vercel.cli', 'auth.json'),
  ];
  let authPath = candidates.find(p => fs.existsSync(p));
  if (!authPath) {
    console.error('auth.json not found in candidate paths');
    process.exit(1);
  }
  const auth = JSON.parse(fs.readFileSync(authPath, 'utf8'));
  const token = auth.token;
  if (!token) {
    console.error('No token in auth.json');
    process.exit(1);
  }

  const projectPath = path.join(process.cwd(), '.vercel', 'project.json');
  const project = JSON.parse(fs.readFileSync(projectPath, 'utf8'));
  const { projectId, orgId: teamId } = project;
  console.log('Project:', project.projectName, 'ID:', projectId, 'Team:', teamId);

  // Read .env.local
  const envContent = fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8');
  const envLines = envContent.split('\n');
  const envVars = {};
  for (const line of envLines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx > 0) {
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();
      // Remove wrapping quotes if present
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      envVars[key] = val;
    }
  }

  console.log('Loaded env keys from .env.local:', Object.keys(envVars));

  // Get current env vars from Vercel
  const listUrl = `https://api.vercel.com/v9/projects/${projectId}/env?teamId=${teamId}`;
  const listRes = await fetch(listUrl, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!listRes.ok) {
    console.error('Failed to list envs:', listRes.status, await listRes.text());
    process.exit(1);
  }
  const listData = await listRes.json();
  const existingEnvs = listData.envs || [];
  console.log('Current Vercel env keys:', existingEnvs.map(e => e.key));

  const existingMap = new Map();
  for (const e of existingEnvs) {
    existingMap.set(e.key, e);
  }

  for (const [key, val] of Object.entries(envVars)) {
    const targets = ['production', 'preview', 'development'];
    const isSecret = key.includes('JSON') || key.includes('SECRET') || key.includes('KEY');
    const type = isSecret ? 'encrypted' : 'plain';

    if (existingMap.has(key)) {
      const existing = existingMap.get(key);
      const patchUrl = `https://api.vercel.com/v9/projects/${projectId}/env/${existing.id}?teamId=${teamId}`;
      const patchRes = await fetch(patchUrl, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          value: val,
          target: targets,
          type
        })
      });
      if (patchRes.ok) {
        console.log(`Updated ${key} successfully`);
      } else {
        console.error(`Failed to update ${key}:`, patchRes.status, await patchRes.text());
      }
    } else {
      const postUrl = `https://api.vercel.com/v10/projects/${projectId}/env?teamId=${teamId}`;
      const postRes = await fetch(postUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          key,
          value: val,
          type,
          target: targets
        })
      });
      if (postRes.ok) {
        console.log(`Created ${key} successfully`);
      } else {
        console.error(`Failed to create ${key}:`, postRes.status, await postRes.text());
      }
    }
  }

  console.log('Environment variable sync complete.');
}

main().catch(err => {
  console.error('Error syncing:', err);
  process.exit(1);
});
