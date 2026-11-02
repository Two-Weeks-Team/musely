// Map ground is y=0. Authored paving thickness is shared with placement readback.
export function surfaceHeightAt(x:number,z:number){let y=0;if(Math.hypot(x,z-2)<=4.2)y=.046;if(x>=-3.8&&x<=1.6&&Math.abs(z+3)<=.55)y=Math.max(y,.0475);if(Math.abs(x+8)<=1.9&&Math.abs(z-5)<=1.7)y=Math.max(y,.23);return y;}
