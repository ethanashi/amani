// Trusted, tool-free HTTP client. Real credentials remain in the host broker.
let input='';for await(const c of process.stdin)input+=c;
try {
 const {port,anthropic,model,prompt,effort}=JSON.parse(input);
 const body=anthropic?{model,max_tokens:4096,messages:[{role:'user',content:prompt}]}:{model,messages:[{role:'user',content:prompt}],...(effort?{reasoning_effort:effort}:{})};
 const r=await fetch(`http://127.0.0.1:${port}/v1/${anthropic?'messages':'chat/completions'}`,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${process.env.OMB_BROKER_TOKEN}`} ,body:JSON.stringify(body)});
 const data=await r.json();process.stdout.write(JSON.stringify({type:'api-result',status:r.status,retryAfter:r.headers.get('retry-after'),data})+'\n');
}catch{process.stdout.write('{"type":"api-result","status":502,"data":{"error":{"message":"Provider transport unavailable"}}}\n');}
