-- Trusted presentation-only filter. Content has already passed the AST genre lint.
local two_column=false
local function tex(blocks) return pandoc.write(pandoc.Pandoc(blocks), 'latex'):gsub('%s+$','') end
local function txt(s) return tex({pandoc.Plain({pandoc.Str(s)})}) end
local function tabletex(t)
  local cols = #t.colspecs
  local rows = {}
  local function row(r,head)
    local cells = {}
    for _,c in ipairs(r.cells) do
      local v=tex(c.contents)
      if head then v='\\textbf{'..v..'}' end
      cells[#cells+1]=v
    end
    rows[#rows+1]=table.concat(cells,' & ')..' \\\\'
  end
  for _,r in ipairs(t.head.rows) do row(r,true) end
  rows[#rows+1]='\\midrule'
  for _,b in ipairs(t.bodies) do
    for _,r in ipairs(b.head) do row(r,true) end
    for _,r in ipairs(b.body) do row(r,false) end
  end
  for _,r in ipairs(t.foot.rows) do row(r,false) end
  return '\\noindent\\begin{tabularx}{\\linewidth}{@{}'..string.rep('>{\\raggedright\\arraybackslash}X',cols)..'@{}}\n\\toprule\n'..table.concat(rows,'\n')..'\n\\bottomrule\n\\end{tabularx}'
end
function Div(d)
  if d.classes:includes('title-page') or d.classes:includes('abstract') then return {} end
  if d.classes:includes('table') then
    local tab,heading,caption
    for _,b in ipairs(d.content) do
      if b.t=='Table' then tab=b elseif b.t=='Header' then heading=b else caption=b end
    end
    if tab and heading then
      local title=pandoc.utils.stringify(heading.content):gsub('^Table %d+%.%s*','')
      local env=two_column and d.attributes['float-width']=='page' and 'table*' or 'table'
      return pandoc.RawBlock('latex','\\begin{'..env..'}[!hbp]\n\\centering\n\\caption{'..txt(title)..'}\\label{'..heading.identifier..'}\n'..tabletex(tab)..'\n\\par\\smallskip{\\normalsize '..(caption and tex({caption}) or '')..'}\n\\end{'..env..'}')
    end
  end
end
function Figure(f)
  local image
  f:walk({Image=function(i) image=i end})
  if image then
    local cap=pandoc.utils.stringify(f.caption.long):gsub('^Figure %d+%.%s*','')
    local env=two_column and image.attributes['float-width']=='page' and 'figure*' or 'figure'
    local id=f.identifier~='' and f.identifier or image.identifier
    return pandoc.RawBlock('latex','\\begin{'..env..'}[!hbp]\n\\centering\n\\includegraphics[width=\\linewidth]{'..image.src:gsub('%.svg$','.pdf')..'}\n\\caption{'..txt(cap)..'}\\label{'..id..'}\n\\end{'..env..'}')
  end
end
-- Untitled generated tables (AI provenance / checklists) also need column-safe tabularx.
-- Div must see the Table before this second pass.
-- Digests remain exact visible text. Discretionary breaks add no glyphs and
-- prevent authenticated provenance from overflowing a narrow column.
local function digest_breaks(s)
  local out=pandoc.List(); local at=1; local changed=false
  while true do
    local first,last=s.text:find('%x+',at)
    if not first then break end
    if last-first+1==64 then
      if first>at then out:insert(pandoc.Str(s.text:sub(at,first-1))) end
      local digest=s.text:sub(first,last)
      out:insert(pandoc.RawInline('latex',digest:gsub('.','%0\\allowbreak{}')))
      at=last+1;changed=true
    else
      out:insert(pandoc.Str(s.text:sub(at,last)));at=last+1
    end
  end
  if not changed then return nil end
  if at<=#s.text then out:insert(pandoc.Str(s.text:sub(at))) end
  return out
end
local function provenance_paragraph(p)
  local needs=false
  p:walk({Str=function(s)
    for token in s.text:gmatch('%x+') do if #token==64 then needs=true end end
    if s.text:find('%d%d%d%d%-%d%d%-%d%dT') then needs=true end
  end})
  if needs then return {pandoc.RawBlock('latex','{\\raggedright'),p,pandoc.RawBlock('latex','\\par}')} end
end
local in_declarations=false
return {{Meta=function(m) two_column=m.twocolumn==true end},{Para=provenance_paragraph},{Str=digest_breaks},{Div=Div,Figure=Figure},{Table=function(t)return pandoc.RawBlock('latex',(#t.colspecs>=4 and '\\begin{'..(two_column and 'table*' or 'table')..'}[t]\n\\caption*{AI systems and author oversight (Methods)}\n' or '')..'{\\normalsize\n'..tabletex(t)..'\n}'..(#t.colspecs>=4 and '\n\\end{'..(two_column and 'table*' or 'table')..'}' or ''))end},
 {Header=function(h)
   if h.identifier=='references' then return pandoc.RawBlock('latex','\\FloatBarrier\n\\section*{References}\n\\input{paper.bbl}') end
   if h.attributes['section-id']=='declarations' then in_declarations=true end
   if in_declarations or h.attributes['section-id']=='plain_summary' or h.attributes['section-id']=='declarations' then h.classes:insert('unnumbered') end
   return h
 end,Div=function(d)if d.identifier=='refs' then return {} end end}}
