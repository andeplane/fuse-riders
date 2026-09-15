import { sin, cos } from './deterministic-math.js';
export interface RiderPose { x:number; y:number; angle:number; drunkHeadingOffset:number }
export interface MotionControls { left:boolean; right:boolean }
export interface MotionStep { distance:number; turn:number; drunkHeadingOffset:number }
/** Pure turn-then-move kernel. Collision/portal arbitration belongs to the shared game step. */
export function advanceRiderPose(pose:Readonly<RiderPose>, controls:Readonly<MotionControls>, step:Readonly<MotionStep>):RiderPose {
  const tau=Math.PI*2;
  const heading=pose.angle-pose.drunkHeadingOffset+(Number(controls.right)-Number(controls.left))*step.turn+step.drunkHeadingOffset;
  const angle=((heading%tau)+tau)%tau;
  return {x:pose.x+cos(angle)*step.distance,y:pose.y+sin(angle)*step.distance,angle,drunkHeadingOffset:step.drunkHeadingOffset};
}
