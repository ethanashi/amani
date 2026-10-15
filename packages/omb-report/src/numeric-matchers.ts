/*
MIT License

Copyright (c) 2024 Technion-Kishony-lab

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

TypeScript port, modified for strict ordered matching; see THIRD_PARTY_NOTICES.md.
*/
import { requireThat } from './common.ts';
function numeric(text:string):number{const n=Number(text.replace(/,/gu,''));requireThat(text.trim()&&Number.isFinite(n),'invalid numeric token');return n;}
export function getNumberOfSignificantFigures(text:string,removeTrailingZeros=true):number{
 let digits=text.toLowerCase().split('e')[0]!.replace(/[.,+-]/gu,'').replace(/^0+/u,'');if(removeTrailingZeros)digits=digits.replace(/0+$/u,'');return Math.max(1,digits.length);
}
export function roundToNDigits(text:string,digits:number,removeSign=true):number{
 requireThat(Number.isSafeInteger(digits)&&digits>=1&&digits<=100,'invalid precision');
 const value=numeric(text);if(value===0)return 0;
 // Python's g-format uses nearest/even on the exact binary float. JS toPrecision
 // rounds ties away, so compute the exact rational before decimal rounding.
 const abs=Math.abs(value),view=new DataView(new ArrayBuffer(8));view.setFloat64(0,abs);
 const bits=view.getBigUint64(0),exponent=Number((bits>>52n)&2047n);
 let numerator=(bits&((1n<<52n)-1n))+(exponent?1n<<52n:0n),denominator=1n;
 const binaryPower=exponent?exponent-1023-52:-1074;
 if(binaryPower>=0)numerator<<=BigInt(binaryPower);else denominator<<=BigInt(-binaryPower);
 const decimalExponent=Number(abs.toExponential().split('e')[1]);const scale=digits-1-decimalExponent;
 if(scale>=0)numerator*=10n**BigInt(scale);else denominator*=10n**BigInt(-scale);
 let q=numerator/denominator;const remainder=numerator%denominator;
 if(remainder*2n>denominator||remainder*2n===denominator&&q%2n===1n)q++;
 const rounded=Number(`${q}e${-scale}`);return removeSign?rounded:Math.sign(value)*rounded;
}
export function truncateToNDigits(text:string,digits:number,removeSign=true):number{
 requireThat(Number.isSafeInteger(digits)&&digits>=1&&digits<=100,'invalid precision');
 const value=numeric(text);if(value===0)return 0;
 // Port uses the decimal string, avoiding floating-point truncation at boundaries.
 const [mantissa,powerText]=text.replace(/,/gu,'').toLowerCase().split('e');let power=Number(powerText??0);let count=0,leading=true,point=false;let end=mantissa!.length-1;
 for(let i=0;i<mantissa!.length;i++){const c=mantissa![i]!;if(c==='-'||c==='+')continue;if(c==='.'){point=true;continue;}if(leading&&c!=='0')leading=false;if(!leading)count++;if(count===digits){end=i;break;}}
 if(!point)power+=mantissa!.length-end-1;
 const v=Number(mantissa!.slice(0,end+1))*10**power;return removeSign?Math.abs(v):v;
}
export function isAnyMatchingValueAfterRoundingToNDigits(source:readonly string[],target:number,digits:number):boolean{return source.some(s=>roundToNDigits(s,digits)===target||s.endsWith('5')&&roundToNDigits(s.slice(0,-1)+'6',digits)===target);}
export function isAnyMatchingValueAfterTruncatingToNDigits(source:readonly string[],target:number,digits:number):boolean{return source.some(s=>truncateToNDigits(s,digits)===target);}
export function isAfterSmallerThanSign(number:string,target:string):boolean{let i=target.indexOf(number);while(i>=0){if(/<\s*$/u.test(target.slice(0,i)))return true;i=target.indexOf(number,i+number.length);}return false;}
export function isPercentage(number:string,target:string,distance=30):boolean|null{
 let i=target.indexOf(number);while(i>=0){if(target[i+number.length]==='%')return true;if(/\bpercent(?:age)?\b/iu.test(target.slice(Math.max(0,i-distance),i+number.length+distance)))return null;i=target.indexOf(number,i+number.length);}return false;
}
export function extractNumericValues(text:string):string[]{return text.replace(/\{,\}|,/gu,'').match(/[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?/gu)??[];}
export interface SpanlessNumber {raw:number;display:string;kind:'number'|'percent'|'p'}
/** Each extracted number matches the SAME ordered fact; no global bag, sign erasure,
 * low-integer exemption, universal percent conversion, or blanket '<' exemption. */
export function matchSpanlessNumbers(text:string,expected:readonly SpanlessNumber[], exactDisplay=false):boolean{
 const tokens=extractNumericValues(text);if(tokens.length!==expected.length)return false;
 return tokens.every((token,i)=>{const fact=expected[i]!;const displays=extractNumericValues(fact.display);if(displays.length!==1)return false;
  if(numeric(token)!==numeric(displays[0]!))return false;
  if(exactDisplay)return token===displays[0];
  const smaller=isAfterSmallerThanSign(token,text),expectedSmaller=isAfterSmallerThanSign(displays[0]!,fact.display);
  if(smaller!==expectedSmaller)return false;
  if(smaller)return fact.kind==='p'&&fact.raw>=0&&fact.raw<numeric(token);
  const target=numeric(token),source=fact.kind==='percent'?fact.raw*100:fact.raw;
  if(Math.sign(target)!==Math.sign(source)&&target!==0)return false;
  const precision=getNumberOfSignificantFigures(token,false);
  return roundToNDigits(String(source),precision,false)===target;
 });
}
