// Prototype Peggy du DSL (spike ADR-003). Produit un AST {t, ...} avec positions.
{{
  function bin(head, tail) {
    return tail.reduce((l, x) => ({ t: 'bin', op: x.op, l, r: x.r, pos: x.pos }), head);
  }
}}

Start = _ e:Ternary _ { return e; }

Ternary
  = c:Or _ "?" _ a:Ternary _ ":" _ b:Ternary { return { t: 'if', c, a, b, pos: location().start.offset }; }
  / Or

Or  = h:And t:(_ op:"||" _ r:And { return { op, r, pos: location().start.offset }; })* { return bin(h, t); }
And = h:Cmp t:(_ op:"&&" _ r:Cmp { return { op, r, pos: location().start.offset }; })* { return bin(h, t); }
Cmp = h:Add t:(_ op:("==" / "!=" / "<=" / ">=" / "<" / ">") _ r:Add { return { op, r, pos: location().start.offset }; })* { return bin(h, t); }
Add = h:Mul t:(_ op:("+" / "-") _ r:Mul { return { op, r, pos: location().start.offset }; })* { return bin(h, t); }
Mul = h:Unary t:(_ op:("*" / "/" / "%") _ r:Unary { return { op, r, pos: location().start.offset }; })* { return bin(h, t); }

Unary
  = "-" _ e:Unary { return { t: 'neg', e, pos: location().start.offset }; }
  / "!" _ e:Unary { return { t: 'not', e, pos: location().start.offset }; }
  / Postfix

Postfix
  = h:Primary t:(_ "." _ n:Ident { return { k: 'member', n, pos: location().start.offset }; }
              / _ "(" _ a:Args? _ ")" { return { k: 'call', a: a || [], pos: location().start.offset }; })* {
    return t.reduce((e, s) => s.k === 'member'
      ? { t: 'member', e, n: s.n, pos: s.pos }
      : { t: 'call', f: e, a: s.a, pos: s.pos }, h);
  }

Args = h:Ternary t:(_ "," _ e:Ternary { return e; })* { return [h, ...t]; }

Primary
  = n:Number { return { t: 'num', v: n, pos: location().start.offset }; }
  / s:String { return { t: 'str', v: s, pos: location().start.offset }; }
  / "true" ![A-Za-z0-9_] { return { t: 'bool', v: true, pos: location().start.offset }; }
  / "false" ![A-Za-z0-9_] { return { t: 'bool', v: false, pos: location().start.offset }; }
  / n:Ident { return { t: 'id', n, pos: location().start.offset }; }
  / "(" _ e:Ternary _ ")" { return e; }

Number = $([0-9]+ ("." [0-9]+)?)
String = '"' s:$([^"]*) '"' { return s; }
Ident = $([A-Za-z_][A-Za-z0-9_]*)
_ = [ \t\r\n]*
