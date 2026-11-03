import {mkdir,readdir,stat,writeFile} from 'node:fs/promises';
import {resolve,join,sep} from 'node:path';

/** Reserve a new run's filenames. Existing evidence is never overwritten. */
export async function openEvidenceOutput({directory,source,prefix,pin}) {
  const out=resolve(directory),root=resolve(source);
  if(out===root||out.startsWith(root+sep))throw Error('Evidence must be outside the release checkout');
  if(prefix!==undefined&&!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(prefix))throw Error('Invalid evidence filename prefix');
  if(prefix===undefined)await mkdir(out,{recursive:false});
  else {
    if(!(await stat(out)).isDirectory())throw Error('Existing evidence directory required');
    if((await readdir(out)).some(name=>name.startsWith(prefix+'-')))throw Error('Evidence prefix already exists');
  }
  const file=name=>join(out,(prefix===undefined?'':prefix+'-')+name);
  await writeFile(file('pin.json'),JSON.stringify(pin,null,2)+'\n',{flag:'wx'});
  return file;
}
