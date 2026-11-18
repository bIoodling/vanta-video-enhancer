// A bounded bilateral source stageIndex followed by clamped reconstruction.
// All channels are processed in display-referred RGB; browser upload handles video YUV conversion.
export const wgsl = `
struct Params { source:vec2f, output:vec2f, radius:f32, sharp:f32, denoise:f32, stageIndex:f32 }
@group(0) @binding(0) var image:texture_2d<f32>;
@group(0) @binding(1) var linearSampler:sampler;
@group(0) @binding(2) var<uniform> p:Params;
struct Vertex { @builtin(position) position:vec4f, @location(0) uv:vec2f }
@vertex fn vs(@builtin(vertex_index) i:u32)->Vertex {
 var xy=array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3));
 var v:Vertex; v.position=vec4f(xy[i],0,1); v.uv=vec2f((xy[i].x+1)*.5,(1-xy[i].y)*.5); return v;
}
fn sampleAt(uv:vec2f)->vec3f{return textureSampleLevel(image,linearSampler,clamp(uv,vec2f(0),vec2f(1)),0).rgb;}
fn cubic(x:f32)->f32 {let a=abs(x);if(a<1){return 1.5*a*a*a-2.5*a*a+1;}if(a<2){return -.5*a*a*a+2.5*a*a-4*a+2;}return 0;}
fn sinc(x:f32)->f32{if(abs(x)<.0001){return 1;}return sin(3.14159265*x)/(3.14159265*x);}
fn kernel(x:f32)->f32{if(p.radius<2.5){return cubic(x);}if(abs(x)>=3){return 0;}return sinc(x)*sinc(x/3);}
@fragment fn fs(v:Vertex)->@location(0) vec4f{
 let uv=v.uv;let px=1/p.source;let center=sampleAt(uv);
 if(p.stageIndex<.5){
 var total=vec3f(0);var weights=0.;let r=i32(p.radius);
 for(var y=-3;y<=3;y++){for(var x=-3;x<=3;x++){if(abs(x)<=r&&abs(y)<=r){let n=sampleAt(uv+vec2f(f32(x),f32(y))*px);let d=n-center;let spatial=exp(-f32(x*x+y*y)/(2*p.radius*p.radius));let w=spatial*exp(-dot(d,d)*120.);total+=n*w;weights+=w;}}}
 let clean=mix(center,total/max(weights,.001),p.denoise);return vec4f(clean,1);
 }
 var value=center;
 if(p.radius>1.5){let pos=uv*p.source-.5;let base=floor(pos);var sum=vec3f(0);var weight=0.;let r=select(2,3,p.radius>2.5);
 for(var y=-2;y<=3;y++){for(var x=-2;x<=3;x++){if(x>=1-r&&x<=r&&y>=1-r&&y<=r){let offset=vec2f(f32(x),f32(y));let w=kernel(pos.x-base.x-offset.x)*kernel(pos.y-base.y-offset.y);sum+=sampleAt((base+offset+.5)*px)*w;weight+=w;}}}value=sum/max(weight,.001);}
 let n=sampleAt(uv-vec2f(0,px.y));let s=sampleAt(uv+vec2f(0,px.y));let e=sampleAt(uv+vec2f(px.x,0));let w=sampleAt(uv-vec2f(px.x,0));
 let lo=min(center,min(min(n,s),min(e,w)));let hi=max(center,max(max(n,s),max(e,w)));
 let gx=dot(abs(e-w),vec3f(.2126,.7152,.0722));let gy=dot(abs(n-s),vec3f(.2126,.7152,.0722));
 let localMean=mix((n+s+e+w)*.25,select((e+w)*.5,(n+s)*.5,gx>gy),select(0.,.6,p.radius>2.5));
 value=clamp(value+(center-localMean)*p.sharp,lo,hi);
 return vec4f(clamp(value,vec3f(0),vec3f(1)),1);
}`;
export const vertexGL = `#version 300 es
precision highp float;
out vec2 uv;
void main(){vec2 q=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));uv=q;gl_Position=vec4(q*2.-1.,0,1);}`;
export const fragmentGL = `#version 300 es
precision highp float;
uniform sampler2D image;uniform vec2 source;uniform float radius,sharp,denoise,stageIndex;
in vec2 uv;out vec4 color;
vec3 at(vec2 q){return texture(image,clamp(q,vec2(0),vec2(1))).rgb;}
float cubic(float x){float a=abs(x);if(a<1.)return 1.5*a*a*a-2.5*a*a+1.;if(a<2.)return -.5*a*a*a+2.5*a*a-4.*a+2.;return 0.;}
float sinc(float x){return abs(x)<.0001?1.:sin(3.14159265*x)/(3.14159265*x);}
float kernel(float x){return radius<2.5?cubic(x):(abs(x)>=3.?0.:sinc(x)*sinc(x/3.));}
void main(){vec2 px=1./source;vec3 c=at(uv);
if(stageIndex<.5){vec3 sum=vec3(0);float total=0.;int r=int(radius);for(int y=-3;y<=3;y++){for(int x=-3;x<=3;x++){if(abs(x)<=r&&abs(y)<=r){vec3 n=at(uv+vec2(x,y)*px);vec3 d=n-c;float w=exp(-float(x*x+y*y)/(2.*radius*radius))*exp(-dot(d,d)*120.);sum+=n*w;total+=w;}}}color=vec4(mix(c,sum/max(total,.001),denoise),1);return;}
vec3 value=c;if(radius>1.5){vec2 pos=uv*source-.5,base=floor(pos);vec3 sum=vec3(0);float total=0.;int r=radius>2.5?3:2;for(int y=-2;y<=3;y++){for(int x=-2;x<=3;x++){if(x>=1-r&&x<=r&&y>=1-r&&y<=r){vec2 o=vec2(x,y);float w=kernel(pos.x-base.x-o.x)*kernel(pos.y-base.y-o.y);sum+=at((base+o+.5)*px)*w;total+=w;}}}value=sum/max(total,.001);}
vec3 n=at(uv-vec2(0,px.y)),s=at(uv+vec2(0,px.y)),e=at(uv+vec2(px.x,0)),w=at(uv-vec2(px.x,0));vec3 lo=min(c,min(min(n,s),min(e,w))),hi=max(c,max(max(n,s),max(e,w)));
float gx=dot(abs(e-w),vec3(.2126,.7152,.0722)),gy=dot(abs(n-s),vec3(.2126,.7152,.0722));vec3 localMean=mix((n+s+e+w)*.25,gx>gy?(n+s)*.5:(e+w)*.5,radius>2.5?.6:0.);
color=vec4(clamp(value+(c-localMean)*sharp,lo,hi),1);}`;
