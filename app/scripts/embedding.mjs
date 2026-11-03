export function renderTemplate(template,css,js){return template.replace('/*WORLD_STYLE*/',()=>css).replace('/*WORLD_SCRIPT*/',()=>js.replace(/<\/script/gi,'<\\/script'));}
/** Production shell uses only build-generated same-origin content-hash URLs. Inline proof remains supported above. */
export function renderExternalTemplate(template,cssURL,scriptURL,module=false){
 for(const url of[cssURL,scriptURL])if(!/^\/assets\/[a-z0-9-]+\.[a-f0-9]{64}\.(css|js)$/.test(url))throw Error('Invalid hashed entry URL');
 if(!template.includes('<style>/*WORLD_STYLE*/</style>')||!template.includes('<script>/*WORLD_SCRIPT*/</script>'))throw Error('Missing entry placeholders');
 return template.replace('<style>/*WORLD_STYLE*/</style>',()=>`<link rel="stylesheet" href="${cssURL}">`).replace('<script>/*WORLD_SCRIPT*/</script>',()=>module?`<script type="module" src="${scriptURL}"></script>`:`<script defer src="${scriptURL}"></script>`);
}
