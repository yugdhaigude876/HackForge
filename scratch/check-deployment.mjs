import fs from 'node:fs';
import path from 'node:path';

async function main() {
  const authPath = path.join(process.env.APPDATA, 'com.vercel.cli', 'Data', 'auth.json');
  const auth = JSON.parse(fs.readFileSync(authPath, 'utf8'));
  const token = auth.token;
  const projectPath = path.join(process.cwd(), '.vercel', 'project.json');
  const project = JSON.parse(fs.readFileSync(projectPath, 'utf8'));
  const { projectId, orgId: teamId } = project;

  const url = `https://api.vercel.com/v6/deployments?projectId=${projectId}&teamId=${teamId}&limit=5`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) {
    console.error('Failed to get deployments:', res.status, await res.text());
    return;
  }
  const data = await res.json();
  const deployments = data.deployments || [];
  console.log(`Found ${deployments.length} recent deployments:`);
  for (const d of deployments) {
    console.log(`- ID: ${d.uid} | URL: https://${d.url} | State: ${d.state || d.readyState} | Created: ${new Date(d.createdAt).toLocaleTimeString()} | Target: ${d.target}`);
  }
}

main().catch(console.error);
