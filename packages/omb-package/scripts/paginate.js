(async()=>{
  await document.fonts.ready;
  const source=document.querySelector('main');
  const lines=document.body.dataset.lines==='true';
  const blocks=[...source.children].flatMap(e=>(e.hasAttribute('statement-id')||['csl-bib-body','table','abstract'].some(c=>e.classList.contains(c)))?[...e.children]:[e]);
  const holder=document.createElement('div');holder.id='pages';source.replaceWith(holder);
  let content, page;
  const create=()=>{page=document.createElement('section');page.className='page';content=document.createElement('div');content.className='page-content';page.append(content);holder.append(page);};
  const height=864;create();
  function add(block){
    if(block.classList.contains('title-page')){content.append(block);create();return;}
    content.append(block);
    if(content.getBoundingClientRect().height<=height)return;
    block.remove();
    if(content.children.length){
      const headings=[];
      while(content.lastElementChild&&/^H[1-6]$/.test(content.lastElementChild.tagName)){const h=content.lastElementChild;h.remove();headings.unshift(h);}
      if(content.children.length)create();
      content.append(...headings,block);if(content.getBoundingClientRect().height<=height)return;block.remove();
    }
    // Split tables only at complete rows, preserving the header. Never scale text down.
    if(block.tagName==='TABLE'){
      const rows=[...block.querySelectorAll('tbody>tr')];
      let t=block.cloneNode(true);t.querySelector('tbody').replaceChildren();content.append(t);
      for(const row of rows){t.querySelector('tbody').append(row);if(content.getBoundingClientRect().height>height){row.remove();if(!t.querySelector('tbody').children.length)throw Error('Table row exceeds page');create();t=block.cloneNode(true);t.querySelector('tbody').replaceChildren(row);content.append(t);}}
      return;
    }
    // Long limitation/checklist lists split only between complete items. Keep
    // every item's markup and order; an oversized item still fails closed.
    if(block.tagName==='UL'){
      const items=[...block.children];
      if(items.some(item=>item.tagName!=='LI'))throw Error('Malformed list');
      let list=block.cloneNode(false);content.append(list);
      for(const item of items){
        list.append(item);
        if(content.getBoundingClientRect().height>height){
          item.remove();if(!list.children.length)throw Error('List item exceeds page');
          create();list=block.cloneNode(false);list.removeAttribute('id');list.append(item);content.append(list);
          if(content.getBoundingClientRect().height>height)throw Error('List item exceeds page');
        }
      }
      return;
    }
    // A very long paragraph is split at word boundaries using DOM ranges, preserving spans.
    if(block.tagName==='P'){
      let rest=block;
      while(rest.textContent.trim()){
        content.append(rest);if(content.getBoundingClientRect().height<=height)return;rest.remove();
        const walker=document.createTreeWalker(rest,NodeFilter.SHOW_TEXT);const points=[];let node;
        while(node=walker.nextNode())for(const m of node.textContent.matchAll(/\S+\s*/g))points.push([node,m.index+m[0].length]);
        let lo=1,hi=points.length-1,best=0;
        const slice=n=>{const range=document.createRange();range.setStart(rest,0);range.setEnd(...points[n-1]);const el=rest.cloneNode(false);el.append(range.cloneContents());return el;};
        while(lo<=hi){const mid=(lo+hi)>>1;const part=slice(mid);content.append(part);const fits=content.getBoundingClientRect().height<=height;part.remove();if(fits){best=mid;lo=mid+1;}else hi=mid-1;}
        if(!best)throw Error('Unbreakable paragraph');
        content.append(slice(best));const range=document.createRange();range.setStart(rest,0);range.setEnd(...points[best-1]);range.deleteContents();create();
      }
      return;
    }
    throw Error('Block exceeds page: '+block.tagName);
  }
  for(let i=0;i<blocks.length;i++){
    const block=blocks[i];
    // Keep a heading with the first line of the following paragraph.
    if(/^H[1-6]$/.test(block.tagName)&&content.children.length){content.append(block);const h=content.getBoundingClientRect().height;block.remove();if(h+60>height)create();}
    add(block);
  }
  if(!content.children.length)page.remove();
  let n=0;
  for(const [index,p] of [...holder.children].entries()){
    if(lines&&!p.querySelector('.title-page')){
      const tops=new Set();const walk=document.createTreeWalker(p.querySelector('.page-content'),NodeFilter.SHOW_TEXT);let t;
      while(t=walk.nextNode()){
        if(!t.textContent.trim())continue;
        for(const m of t.textContent.matchAll(/\S+/g)){const r=document.createRange();r.setStart(t,m.index);r.setEnd(t,m.index+m[0].length);for(const rect of r.getClientRects())if(rect.width>0)tops.add(Math.round(rect.top-p.getBoundingClientRect().top));}
      }
      let last=-100;
      for(const top of [...tops].sort((a,b)=>a-b)){if(top-last<5)continue;last=top;const label=document.createElement('span');label.className='line-number';label.textContent=String(++n);label.style.top=top+'px';p.append(label);}
    }
    const foot=document.createElement('footer');foot.textContent=String(index+1);p.append(foot);
    if(p.querySelector('.page-content').getBoundingClientRect().height>height+1)throw Error('Page overflow');
  }
  document.body.dataset.paginated='true';
  return {html:'<!DOCTYPE html>\n'+document.documentElement.outerHTML,pages:holder.children.length,lines:n};
})()
