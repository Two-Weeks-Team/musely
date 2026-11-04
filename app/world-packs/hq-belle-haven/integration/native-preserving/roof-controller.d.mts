import type {Map} from 'maplibre-gl';
export interface RoofController {readonly active:boolean;status():{enabled:boolean;active:boolean;reason:string;report:unknown;conflicts:string[]};enable():unknown;refresh():unknown;disable():unknown;dispose():unknown;}
export function createNativeRoofDetails(map:Map,options?:{enabled?:boolean;radius?:number}):RoofController;
export const ROOF_DETAILS_ENABLED:false;
export const ROOF_SOURCE_ID:string;
export const ROOF_LAYER_ID:string;
