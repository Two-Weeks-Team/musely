export function renderTemplate(template,css,js){return template.replace('/*WORLD_STYLE*/',()=>css).replace('/*WORLD_SCRIPT*/',()=>js.replace(/<\/script/gi,'<\\/script'));}
