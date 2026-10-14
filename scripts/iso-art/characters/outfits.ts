/**
 * Outfit cuts, accessories and builds: what makes one worker's silhouette
 * differ from another's, not just its colours. The outfit cut and the
 * build shape the body (`body.ts`); an accessory is drawn onto the head
 * (`head.ts`).
 */

export type OutfitCut = 'collarTie' | 'turtleneck' | 'vest' | 'hoodie' | 'crewTee';
export type Accessory = 'none' | 'glasses' | 'headphones' | 'beard' | 'earrings' | 'lanyard';
export type Build = 'regular' | 'stocky' | 'slim' | 'short' | 'tall';
