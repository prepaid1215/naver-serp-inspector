import assert from 'node:assert/strict';
import {
  readGitHubToken,saveGitHubToken,clearGitHubToken,hasRememberedGitHubToken
} from '../extension/github-token-store.js';

function fakeStore(){
  const data=new Map();
  return {
    data,
    async get(keys){
      const names=Array.isArray(keys)?keys:[keys];
      return Object.fromEntries(names.filter(key=>data.has(key)).map(key=>[key,data.get(key)]));
    },
    async set(items){for(const [key,value] of Object.entries(items))data.set(key,value);},
    async remove(keys){for(const key of Array.isArray(keys)?keys:[keys])data.delete(key);},
    async clear(){data.clear();},
    async setAccessLevel({accessLevel}){assert.equal(accessLevel,'TRUSTED_CONTEXTS');}
  };
}
const local=fakeStore(),session=fakeStore();
globalThis.chrome={storage:{local,session}};
const repo='prepaid1215/serp-lens-private-data',other='someone/another-repo';
assert.equal(await readGitHubToken(repo),'');
assert.equal(await hasRememberedGitHubToken(repo),false);
await saveGitHubToken({repository:repo,token:'example_test_token',remember:false});
assert.equal(await readGitHubToken(repo),'example_test_token');
assert.equal(await hasRememberedGitHubToken(repo),false);
await session.clear(); // simulate closing and reopening Chrome
assert.equal(await readGitHubToken(repo),'');
await saveGitHubToken({repository:repo,token:'example_persistent_token',remember:true});
assert.equal(await hasRememberedGitHubToken(repo),true);
await session.clear();
assert.equal(await readGitHubToken(repo),'example_persistent_token');
assert.equal(await readGitHubToken(other),'');
assert.equal(await hasRememberedGitHubToken(other),false);
await saveGitHubToken({repository:repo,token:'example_volatile_token',remember:false});
await session.clear();
assert.equal(await readGitHubToken(repo),'');
assert.equal(await hasRememberedGitHubToken(repo),false);
await saveGitHubToken({repository:repo,token:'example_revoke_token',remember:true});
await clearGitHubToken();
assert.equal(await readGitHubToken(repo),'');
assert.equal(await hasRememberedGitHubToken(repo),false);
assert.equal(local.data.size,0);
await assert.rejects(saveGitHubToken({repository:'invalid',token:'test',remember:true}));
console.log('GitHub credential storage checks passed');
