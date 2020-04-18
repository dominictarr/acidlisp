var assert = require('assert')
var tape = require('tape')
var {eval: ev, quote, bind} = require('../new-eval')
var syms = require('../symbols')
var parse = require('../parse')
var {isNumber, stringify} = require('../util')

var references = require('../references')
var {
  isSymbol, isFun, isBasic, isFunction, isArray, stringify
} = require('../util')

console.log(ev)

console.log('test 1')

function  $(name) {
  return Symbol(name)
}
var  a =$('a'), b = $('b'), add = $('add'), eq = $('eq')

var scope = new Map()
scope.set(add, function () {
  return [].slice.call(arguments).reduce((a,b) => a + b)
})
scope.set(eq, function (a, b) {
  return a === b
})

tape('eval an inline function call', function (t) {
  var code = [[syms.fun, [a, b], [add, a, b, 3]], 1, 2]

  console.log(ev(code, scope))
  t.equal(ev(code, scope), 6)
  t.end()
})


var x = $('x'), y = $('y')
var fun = [syms.fun, [x, y], [add, x, y]]

// evaluating the exact same function twice should produce
// two distinct bound functions. this might happen to a function
// defined inside a loop
tape('separately evaled functions are not equal', function (t) {
  t.notStrictEqual(ev(fun, scope), ev(fun, scope))
  t.end()
})

function U (ast) { return [syms.unquote, ast] }
function Q (ast) { return [syms.quote, ast] }

var quoted = ev(Q([a, b, U([add, 1, 2])]), scope)
tape('quote and unquote', function (t) {

  t.strictEqual(quoted[0], a)
  t.strictEqual(quoted[1], b)
  t.strictEqual(quoted[2], 3)

  t.end()
})

console.log('test 4, macros and quotes')

var mac = [syms.mac, [x], Q([syms.def, U(x), [add, U(x), 1]])]
var j = $('j'), k = $('k'), tmp = $('tmp')

function dehygene (src) {
  return src.replace(/__\d+/g, '')
}

tape('macro eval', function (t) {
//  var scope = new Map()
  var z = $('z')
  var incr_z = bind([mac, z], scope)
  //this macro operates on a symbol passed in,
  //so it does not need to have added hygene
  t.deepEqual(stringify(incr_z), '(def z (add z 1))')

  t.strictEquals(incr_z[1], z, 'a symbol passed to a macro will be equal to output')
  t.strictEquals(incr_z[2][1], z, 'a symbol passed to a macro will be equal to output, 2')

  //NOTE: if you use unquote outside of quote, it will run that code
  //at bind time.
  t.deepEqual(stringify(bind([add, 1, U([add, 7, 3]) ], scope)), '(add 1 10)')
  t.end()
})

var swap = [syms.mac,
  [j, k],
  Q([syms.block,
    [syms.def, tmp, U(j)],
    [syms.set, U(j), U(k)],
    [syms.set, U(k), tmp]
  ])
]

tape('a macro that creates an internal var should be distinct between runs', function (t) {

  var scope1 = new Map()
  scope1.parent = scope
  var scope2 = new Map()
  scope2.parent = scope
  
  var swap_ab = bind([swap, a, b], scope1)
  var swap_xy = bind([swap, x, y], scope2)
  console.log(swap_ab)
  console.log(swap_xy)
  console.log(scope1)
  console.log(scope2)
  t.equal(dehygene(swap_ab[1][1].description), dehygene(swap_xy[1][1].description))
//XXX disable for now
  t.notStrictEqual(swap_ab[1][1], swap_xy[1][1])
  console.log(swap_ab)
  console.log(swap_xy)

  t.end()
})

//what about if a quote is inside an unquote inside a quote?

// %(a b $(if (lt a b) %a %b))

//i think that's fully reasonable.
//for this to be possible

tape('references within a scope are identical', function (t) {
  var scope = new Map()
  var ast = parse('(quote (block (def foo 1) (add foo (def bar 3)) ))')
  var refs = references(ast, scope)
  //console.log('refs', refs)
  console.log(references.dump(ast, refs))
 // console.log(ast)

  t.strictEquals(ast[1][1][1], ast[1][2][1])
  var _ast = ev(ast, scope)
  //console.log(_ast)

  t.equals(dehygene(stringify(_ast)), '(block (def foo 1) (add foo (def bar 3)))')

  t.end()

})



tape('what happens if a macro calls another macro?', function (t) {
  function add () {
    var args = [].slice.call(arguments)
    if(!args.every(isNumber)) throw new Error('argument was not number:'+stringify(args))
    return args.reduce((a, b)=>a+b, 0)
  }
  function sub () {
    var args = [].slice.call(arguments)
    if(!args.every(isNumber)) throw new Error('argument was not number:'+stringify(args))
    return args.reduce((a, b)=>a-b, 0)
  }
  var scope = {add, sub}
  var src =  `
  (block
    (def defun (mac (name args body)
      &(def $name (fun $name $args $body))
    ))
    (def defmac (mac (name args body)
      &(def $name (mac $name $args $body))
    ))

    (defmac incr [x] &(set $x (add $x 1)))

    (defmac decr [x] &(set $x (sub $x 1)))

    (defun three () {block
      (def y 0)
      (incr y)
      (incr y)
      (incr y)
    })
  )`
  var ast = parse(src)

  var name1 = ast[1][2][1][0]
  t.equal(name1.description, 'name')
  var name2 = ast[1][2][2][1][1][1]
  t.equal(name2.description, 'name')
  //t.strictEqual(name1, name2)
  //t.ok(name1===name2)
  var name3 = ast[1][2][2] [1][2][1][1]
  t.equal(name3.description, 'name')
  //t.strictEqual(name1, name3)
  //t.ok(name1===name3)

  var _scope = new Map()
  _scope.parent = scope

  console.log(ev(ast, _scope))
  
  t.end()

})

tape('if a macro creates a var does not collide', function (t) {

  var scope = {
    assert: function (x) { if(!x) throw new Error('assertion failed:' + x) },
    eq: function (a, b) { console.log('eq?', a, b); return a === b }
  }

  var src =  `
  (block
    (def defun (mac (name args body)
      &(def $name (fun $name $args $body))
    ))
    (def defmac (mac (name args body)
      &(def $name (mac $name $args $body))
    ))

    (defmac swap [x y] &(block
      (def tmp $x)
      (set $x $y)
      (set $y tmp)
    ))

    (defun swapsies () {block
      (def a 1)
      (def b 2)
      (def tmp 7)
      (swap a b)
      (assert (eq a 2))
      (assert (eq b 1))
      (assert (eq tmp 7))
      (list a b tmp)
    })
  )`

  var ast = parse(src)
  
  var _scope = new Map()
  _scope.parent = scope
  var swapsies = Symbol('swapsies')
  var _swap = ev(ast, _scope)
  console.log(stringify(_swap.slice(0, 4)))
  console.log(_swap[3][1][1], _swap[3][4][1][2])
  t.equal(_swap[3][1][1].description, _swap[3][4][1][2].description)
  _scope.set(swapsies, _swap)
  t.deepEqual(ev([swapsies, 0], _scope), [2,1,7])

  t.end()
})
