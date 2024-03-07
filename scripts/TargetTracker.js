/**
 * (c) Meta Platforms, Inc. and its affiliates. Confidential and proprietary.
 */
// @ts-nocheck
 const S = require('Scene');
 const P = require('Patches');
 const R = require('Reactive');
 const A = require('Animation');
 const T = require('Time');
 const TG = require('TouchGestures');
 const TX = require('Textures');
 export const D = require('Diagnostics');

 // Constants for the default visual and interaction style.
 const TARGET_ENVELOPE_SCALE = 1.1;
 const ICON_PLANE_DISTANCE = 0.1;
 const DEFAULT_PLANE_SIZE = 0.1;
 const PLANE_TO_TARGET_TRACKER_RATIO = 3;
 const ICON_FADE_DURATION = 500;
 const ICON_START_DELAY = 0;
 const ICON_INSTRUCTONS_FADE_DURATION = 4000;
 const RETICLE_TRANSITION_DURATION = 500;
 const RETICLE_FADE_DURATION = 500;
 const FIT_SCALE = 0.55;

 class TargetTracker {
   constructor(){
     this.reticleTransitionTimeout = null;
     Promise.all([
       S.root.findFirst('Camera'),
       S.root.findFirst('targetTracker0'),
       S.root.findFirst('targetEnvelope'),
       S.root.findFirst('screenFit'),
       S.root.findFirst('icon'),
       S.root.findFirst('reticle'),
       S.root.findFirst('glint'),
       S.root.findFirst('glintPivot'),
       S.root.findFirst('trackerInstruction'),
       TX.findFirst('replaceMe'),
       P.outputs.getScalar('trackerInstructionProgress'),
     ]).then(p=>{
       this.camera = p[0];
       this.targetTracker = p[1];
       this.targetEnvelope = p[2];
       this.screenFit = p[3];
       this.icon = p[4];
       this.reticle = p[5];
       this.glint = p[6];
       this.glintPivot = p[7];
       this.slamNux = p[8];
       this.targetTexture = p[9];
       this.slamNuxProgress = p[10];
       this.initAfterPromiseResolved();
     }).catch(e=>{
       D.log('Promise Error: '+e.stack);
     });
   }

   // This method is called after all scene objects are found
   initAfterPromiseResolved(){
     this.aspectRatio = this.targetTexture.width.div(this.targetTexture.height);
     this.setupReticleFade();
     this.setupReticleTransition();
     this.setupTargetEnvelope();
     this.setupScreenFit();
     this.setupReticle();
     this.setupIconFade();
     this.setupGlint();
     this.setupTrackerInstruction();
     this.outputToPatch();
   }

   // Setup a square plane to envelop the target image in world space. This serves as an anchor for the reticle. When target are found, the reticle transition to targetEnvelope
   setupTargetEnvelope(){
     let worldTransform = this.targetTracker.worldTransform;
     this.targetEnvelope.transform.position = worldTransform.position;
     this.targetEnvelope.transform.rotationX = worldTransform.rotationX;
     this.targetEnvelope.transform.rotationY = worldTransform.rotationY;
     this.targetEnvelope.transform.rotationZ = worldTransform.rotationZ;
     this.targetEnvelope.transform.scale = worldTransform.scale
       .mul(R.val(PLANE_TO_TARGET_TRACKER_RATIO))
       .div(this.aspectRatio.gt(1).ifThenElse(R.val(1), this.aspectRatio))
       .mul(TARGET_ENVELOPE_SCALE);
     this.targetInView = this.isTargetInView(
       this.targetEnvelope.transform.position,
       this.targetEnvelope.transform.scaleX.mul(DEFAULT_PLANE_SIZE));
   }

   // Setup a square plane that fit in the center of the screen. This serves as an anchor for the reticle. When tracking is not initialized, the reticle rest around the on-screen target image.
   setupScreenFit(){
     let iconScale = R.val(ICON_PLANE_DISTANCE).div(this.camera.focalPlane.distance);
     let fitSize = this.camera.focalPlane.width.gt(this.camera.focalPlane.height).ifThenElse(
       this.camera.focalPlane.height, this.camera.focalPlane.width);
     this.screenFit.transform.scaleX = iconScale
       .mul(fitSize).div(DEFAULT_PLANE_SIZE).mul(FIT_SCALE);
     this.screenFit.transform.scaleY = iconScale
       .mul(fitSize).div(DEFAULT_PLANE_SIZE).mul(FIT_SCALE);
     this.screenFit.transform.z = R.val(-ICON_PLANE_DISTANCE);
   }

   // Setup the reticle to interpolate between targetEnvelope and screenFit.
   setupReticle(){
     this.reticle.transform = R.mix(
       this.screenFit.transform.toSignal(), this.targetEnvelope.transform.toSignal(),
       this.reticleTransition);
   }

   // Setup the animation driver for reticle transition.
   setupReticleTransition(){
     this.reticleTransitionDriver = A.timeDriver({durationMilliseconds: 1000});
     let animationSampler = A.samplers.easeInOutCubic(0, 1);
     this.reticleTransition = A.animate(this.reticleTransitionDriver, animationSampler);
     P.inputs.setScalar('reticleTransition', this.reticleTransition);
     this.targetTracker.confidence.monitor({fireOnInitialValue: true}).subscribe(v=>{
       if (this.reticleTransitionTimeout != null) {
         T.clearTimeout(this.reticleTransitionTimeout);
       }
       if (v.newValue != 'NOT_TRACKING') {
         this.reticleTransitionDriver.reset();
         this.reticleTransitionDriver.start();
         this.reticleTransitionTimeout = T.setTimeout(t=>{
           this.fadeReticle();
         }, RETICLE_TRANSITION_DURATION + RETICLE_FADE_DURATION);
       } else {
         this.reticleTransitionDriver.reverse();
         this.showReticle();
       }
     });
   }

   // Setup the animation driver for reticle showing and fading.
   setupReticleFade(){
     this.reticleFadeDriver = A.timeDriver({durationMilliseconds: 1000});
     let animationSampler = A.samplers.easeInOutCubic(1, 0);
     P.inputs.setScalar('reticleFade', A.animate(this.reticleFadeDriver, animationSampler));
   }

   fadeReticle(){
    this.reticleFadeDriver.reset();
    this.reticleFadeDriver.start();
    P.inputs.setBoolean('showReticle', false);
  }

  showReticle(){
    this.reticleFadeDriver.reverse();
    P.inputs.setBoolean('showReticle', true);
  }

   // Setup icon fade animation driver. The on-screen image icon should fade in and out with the instructions.
   setupIconFade(){
     this.iconFadeDriver = A.timeDriver({durationMilliseconds: ICON_FADE_DURATION});
     let animationSampler = A.samplers.easeInOutCubic(0, 1);
     this.iconVisible = true;
     T.setTimeout(t=>{
       this.showIcon();
     },ICON_START_DELAY);
     T.setInterval(() => {
      if (this.iconVisible){
        this.fadeIcon();
      } else {
        this.showIcon();
      }
     }, ICON_INSTRUCTONS_FADE_DURATION);
     P.inputs.setScalar('iconFade', A.animate(this.iconFadeDriver, animationSampler));
     P.inputs.setBoolean('showIcon', this.iconVisible);
   }

   fadeIcon(){
     this.iconFadeDriver.reverse();
     this.iconVisible = false;
     P.inputs.setBoolean('showIcon', this.iconVisible);
   }

   showIcon(){
     this.iconFadeDriver.reset();
     this.iconFadeDriver.start();
     this.iconVisible = true;
     P.inputs.setBoolean('showIcon', this.iconVisible);
   }

   // Setup the glint to indicate where the target is if the target is not in camera's view. This UI can guide user to the main tracking target.
   setupGlint(){
     let targetPositionX = this.targetEnvelope.transform.x;
     let targetPositionY = this.targetEnvelope.transform.y;
     let xSign = R.sign(targetPositionX);
     let ySign = R.sign(targetPositionY);
     let slope = targetPositionX.eq(0).ifThenElse(
       R.val(0), targetPositionY.div(targetPositionX).abs());
     let screenX = R.val(DEFAULT_PLANE_SIZE/2).mul(xSign);
     let screenY = R.val(DEFAULT_PLANE_SIZE/2).mul(ySign);
     let tipPosition = R.point(
       slope.gt(1).ifThenElse(screenX.div(slope), screenX),
       slope.gt(1).ifThenElse(screenY, screenY.mul(slope)), R.val(0));
     this.glint.transform.position = tipPosition;
     this.glintPivot.transform.rotationZ = this.getZEulerRotation(tipPosition).neg();
     this.glintVisibility = this.targetTracker.outOfViewTrackingActive
      .and(this.targetInView.not()).and(this.isInEditor().not());
     this.glintVisibility.monitor({fireOnInitialValue: true}).subscribe(visible=>{
       if (visible.newValue){
         this.glint.hidden = R.val(false);
       } else {
         this.glint.hidden = R.val(true);
       }
     });
   }

   // Setup tracker instruction to guide the user to initialize SLAM. SLAM is required for successful fixed target tracking experience because the tracker need to understand the world position of the target to establish stable tracking.
   setupTrackerInstruction(){
    this.targetTracker.outOfViewTrackingActive.monitor({fireOnInitialValue: true}).subscribe(v=>{
      P.inputs.setBoolean('trackerInstructionHidden', R.val(v.newValue));
    });
   }

   // Helper function to get the Z euler rotation value from a direction vector
   getZEulerRotation(vector3) {
     let normalizedVector = vector3.normalize();
     return vector3.magnitude().eq(0).ifThenElse(
       R.val(0),
       R.atan2(normalizedVector.x, normalizedVector.y));
   }

   // Clear timeout if user make another touch gesture to prevent timed animations to happen
   clearIconMaximizationTimeout(){
     if (this.iconMaximizationTimeout != null){
       T.clearTimeout(this.iconMaximizationTimeout);
     }
   }

   // Helper method to project a position in camera space to focal plane space.
   projectToFocalPlane(positionInCameraSpace){
     let focalDistanceOverZ = this.camera.focalPlane.distance.div(positionInCameraSpace.z.abs());
     return R.point(
       positionInCameraSpace.x.mul(focalDistanceOverZ),
       positionInCameraSpace.y.mul(focalDistanceOverZ),
       this.camera.focalPlane.distance);
   }

   // Helper method to project an estimated size to focal plane space.
   projectSizeOnFocalPlane(positionInCameraSpace, sizeInCameraSpace){
     let focalDistanceOverZ = this.camera.focalPlane.distance.div(positionInCameraSpace.z.abs());
     return sizeInCameraSpace.mul(focalDistanceOverZ);
   }

   // Helper method to estimate if the target is in camera's view
   isTargetInView(positionInCameraSpace, sizeInCameraSize){
     let position = this.projectToFocalPlane(positionInCameraSpace);
     let size = this.projectSizeOnFocalPlane(positionInCameraSpace, sizeInCameraSize);
     let xEdge = this.camera.focalPlane.width.add(size).div(2);
     let yEdge = this.camera.focalPlane.height.add(size).div(2);
     let isInside = (position.x.lt(xEdge)).and(position.x.gt(xEdge.neg()))
       .and(position.y.lt(yEdge).and(position.y.gt(yEdge.neg())))
       .and(positionInCameraSpace.z.lt(0));
     return isInside;
   }

   // Helper method to determine if the script is running in editor. This is based on the behavior that target tracker and camera is in the same world space position while running in editor.
   isInEditor(){
     let trackerPosition = this.targetTracker.worldTransform.position;
     let cameraPosition = this.camera.worldTransform.position;
     let isXEqual = trackerPosition.x.eq(cameraPosition.x);
     let isYEqual = trackerPosition.y.eq(cameraPosition.y);
     let isZEqual = trackerPosition.z.eq(cameraPosition.z);
     return isXEqual.and(isYEqual).and(isZEqual);
   }

   // Output signals for visual and interaction logic done by Patches
   outputToPatch(){
     P.inputs.setScalar('aspectRatio', this.aspectRatio);
     P.inputs.setBoolean('isInEditor', this.isInEditor());
   }
 }

 const instance = new TargetTracker();
 export default instance;
