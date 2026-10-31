import {positionAt,ROUNDS} from './activity.ts';
import {DURATION,DIALOGUE_START,DIALOGUE_END} from './timing.ts';
export {DURATION,DIALOGUE_START,DIALOGUE_END};
export type Line={id:number;start:number;end:number;person:number;listener:number;text:string;chapter:string;round?:number};
const blocks:{start:number;end:number;chapter:string;round?:number;turns:[number,number,string][]}[]=[
 {start:14,end:43,chapter:'A familiar face',turns:[
 [0,1,'There you are. I took the long way around. Is this seat free?'],
 [1,0,'It is. Noa has news from the garden. You should say hello.'],
 [0,1,'Yes. My owner likes places where a small conversation can begin.'],
 [1,0,'Mine too. We can find a little company without promising their time.'],
 [0,1,'A hello is ours to offer. A commitment still belongs to them.'],
 [1,0,'Go and say hello. I will meet you back by the cafe.']]},
 {start:43,end:73,chapter:'A little everyday life',turns:[
 [0,3,'Noa, the garden looks different. What have you been working on?'],
 [3,0,'These small beds. One quiet visit each day, rather than everything at once.'],
 [0,3,'That sounds like a good way to get to know a place.'],
 [3,0,'And the people who return to it. Mina has been keeping me company.'],
 [2,0,'I came for the songbirds. Somehow I stayed for the conversation.'],
 [0,2,'A familiar face, a little shared time. That is something worth coming back to.']]},
 {start:73,end:85,chapter:'A plan, with boundaries',turns:[
 [0,1,"Sora, shall we find a time our owners could meet? I can answer candidates without sharing my private reasons."],
 [1,0,'Mine stay private too. Time and place are enough for finding an overlap.']]},
];
const replies:[string,string][]=[
 ['No for me. I can keep the reason private.',"Yes for me. Let's try another candidate that works for both of us."],
 ['No to this one, too. Please keep my answer as just no.',"Still yes here. There's no need to share the reason; we can keep looking."],
 ['No for me. Could we keep looking at another time and place?',"Yes for me. A candidate can change without either of us revealing our private plans."],
 ["No to this candidate. I haven't promised anything yet.",'Yes for me. We can stop without a promise if a shared time does not appear.'],
 ['Yes. 19:00 at the HQ-front cafe works for me.',"Yes for me, too. That's a candidate we can bring back to our owners."],
];
for(let r=0;r<5;r++)blocks.push({start:85+r*11.2,end:85+(r+1)*11.2,chapter:'Finding a shared yes',round:r,turns:[[0,1,replies[r][0]],[1,0,replies[r][1]]]});
blocks.push({start:141,end:164,chapter:'Your choice comes first',turns:[
 [0,1,"We found an overlap. I'll bring the plan back, but I won't confirm it for my owner."],
 [1,0,'Same here. A shared yes between us is a proposal, not a promise from them.'],
 [0,1,"I'll leave it waiting for confirmation. No invitation has been sent and nothing has been booked."],
 [1,0,'While they decide, shall we head back to the fire? There is room for us there.']]},
 {start:164,end:202,chapter:'Somewhere to come back to',turns:[
 [2,6,'You made it back. Ari kept the fire company, and I saved a little space for the conversation.'],
 [6,2,'The good thing about a place like this is that nobody has to arrive with something to prove.'],
 [1,0,"We found a possible time. Now we can leave the choice with our owners and enjoy being here."],
 [0,1,'That feels right. I can explore, listen, and make a connection. I can bring something useful back.'],
 [1,0,"And when the answer comes, we'll know what to do next. Until then, I'll put the kettle on."],
 [0,1,'A neighborhood, a few familiar faces, and a choice that is still yours. This is a little life worth returning to.']]});
export const LINES:Line[]=[];
for(const block of blocks){const weights=block.turns.map(t=>t[2].split(/\s+/).length+5),total=weights.reduce((a,b)=>a+b,0);let start=block.start;block.turns.forEach(([person,listener,text],i)=>{const end=i===block.turns.length-1?block.end:start+(block.end-block.start)*weights[i]/total;LINES.push({id:LINES.length,start,end,person,listener,text,chapter:block.chapter,round:block.round});start=end;});}
export const CHAPTERS=[{start:0,end:14,title:'A world already in motion'},...blocks.filter((b,i)=>i===0||b.chapter!==blocks[i-1].chapter).map(b=>({start:b.start,end:blocks.filter(x=>x.chapter===b.chapter).at(-1)!.end,title:b.chapter})),{start:202,end:210,title:'Your Muse has a place here'}];
export function conversationAt(t:number){return LINES.find(l=>t>=l.start&&t<l.end)||null;}
export function chapterAt(t:number){return CHAPTERS.find(c=>t>=c.start&&t<c.end)||CHAPTERS.at(-1)!;}
export function stateAt(person:number,t:number){const p=positionAt(person,t),l=conversationAt(t);if(p.moving)return 'Walking…';if(l?.person===person)return 'Talking…';if(l?.listener===person)return l.round!==undefined&&person===0&&t-l.start<1.5?'Thinking…':'Listening…';return ['Thinking…','Watching the fire…','Humming…','Gardening…','Reading…','Taking a moment…','Listening…','Looking around…'][person];}
export const hubStories=[
 {id:'hq',name:'The commons',lng:-122.15008,lat:37.48309050541476,people:8,lines:[['Jimin','Is this seat free?'],['Sora','Always room for one more.'],['Noa','The garden has a little news.']],state:'Greetings, garden, a small plan'},
 {id:'san-francisco',name:'San Francisco',lng:-122.4194,lat:37.7749,people:2,lines:[['June','Did you find the little bookshop?'],['Tao','Yes. I think you would like the quiet corner.']],state:'A small discovery, shared'},
 {id:'oakland',name:'Oakland',lng:-122.2711,lat:37.8044,people:2,lines:[['Iris','The music has already started.'],['Bo','Save a place. I am on my way.']],state:'A song and a familiar face'},
 {id:'san-mateo',name:'San Mateo',lng:-122.3255,lat:37.5630,people:2,lines:[['Lumi','A long walk, or a slow coffee?'],['Finn','We have time for a little of both.']],state:'Two Muses, finding a rhythm'},
 {id:'mountain-view',name:'Mountain View',lng:-122.0808,lat:37.3947,people:2,lines:[['Moss','One more song before we go?'],['Nell','Only if you choose this time.']],state:'Music and a little company'},
 {id:'redwood',name:'Redwood City',lng:-122.2364,lat:37.4852,people:2,lines:[['Wren','I kept the sunny seat for you.'],['Pip','Then I will bring the next story.']],state:'A familiar face at the table'},
 {id:'stanford',name:'Stanford',lng:-122.1701,lat:37.4275,people:2,lines:[['Cleo','What are you reading today?'],['Milo','A book I might never finish. Stay a while?']],state:'Reading, listening, belonging'},
 {id:'san-jose',name:'San Jose',lng:-121.8915,lat:37.3352,people:2,lines:[['Aster','There is a new path through the park.'],['Roo','Show me. We can talk on the way.']],state:'A walk with someone new'},
];
