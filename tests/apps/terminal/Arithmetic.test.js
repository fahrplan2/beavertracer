//@ts-check

import { describe, it, expect } from 'vitest';
import { evaluateArithmetic, expandArithmetic } from '../../../src/apps/terminal/Arithmetic.js';
import { CommandError } from '../../../src/apps/terminal/commands/lib/errors.js';

describe('evaluateArithmetic', () => {
  it('does basic arithmetic with correct precedence', () => {
    expect(evaluateArithmetic('1+2', {})).toBe(3);
    expect(evaluateArithmetic('2+3*4', {})).toBe(14);
    expect(evaluateArithmetic('(2+3)*4', {})).toBe(20);
    expect(evaluateArithmetic('7%3', {})).toBe(1);
    expect(evaluateArithmetic('7/2', {})).toBe(3);
  });

  it('truncates division/modulo toward zero', () => {
    expect(evaluateArithmetic('-7/2', {})).toBe(-3);
    expect(evaluateArithmetic('-7%2', {})).toBe(-1);
  });

  it('reads bare and $-prefixed variables from env', () => {
    expect(evaluateArithmetic('i+1', { i: '4' })).toBe(5);
    expect(evaluateArithmetic('$i+1', { i: '4' })).toBe(5);
  });

  it('treats an unset variable as 0', () => {
    expect(evaluateArithmetic('x+1', {})).toBe(1);
  });

  it('supports unary minus/plus/not', () => {
    expect(evaluateArithmetic('-5', {})).toBe(-5);
    expect(evaluateArithmetic('+5', {})).toBe(5);
    expect(evaluateArithmetic('!0', {})).toBe(1);
    expect(evaluateArithmetic('!1', {})).toBe(0);
  });

  it('evaluates comparisons to 1/0', () => {
    expect(evaluateArithmetic('3 < 5', {})).toBe(1);
    expect(evaluateArithmetic('5 < 3', {})).toBe(0);
    expect(evaluateArithmetic('5 >= 5', {})).toBe(1);
    expect(evaluateArithmetic('5 == 5', {})).toBe(1);
    expect(evaluateArithmetic('5 != 5', {})).toBe(0);
  });

  it('evaluates && / || with short-circuit-agnostic 1/0 results', () => {
    expect(evaluateArithmetic('1 && 0', {})).toBe(0);
    expect(evaluateArithmetic('1 && 1', {})).toBe(1);
    expect(evaluateArithmetic('0 || 0', {})).toBe(0);
    expect(evaluateArithmetic('0 || 1', {})).toBe(1);
  });

  it('throws on division by zero', () => {
    expect(() => evaluateArithmetic('1/0', {})).toThrow(CommandError);
    expect(() => evaluateArithmetic('1/0', {})).toThrow(/arithDivByZero/);
  });

  it('throws on modulo by zero', () => {
    expect(() => evaluateArithmetic('1%0', {})).toThrow(/arithDivByZero/);
  });

  it('throws when a variable holds a non-numeric value', () => {
    expect(() => evaluateArithmetic('x+1', { x: 'abc' })).toThrow(CommandError);
    expect(() => evaluateArithmetic('x+1', { x: 'abc' })).toThrow(/arithBadValue/);
  });

  it('throws a syntax error for malformed expressions', () => {
    expect(() => evaluateArithmetic('1 +', {})).toThrow(/arithSyntax/);
    expect(() => evaluateArithmetic('(1+2', {})).toThrow(/arithSyntax/);
    expect(() => evaluateArithmetic('', {})).toThrow(/arithSyntax/);
  });
});

describe('expandArithmetic', () => {
  it('replaces a $((...)) span with its decimal result', () => {
    expect(expandArithmetic('echo $((1+2))', {})).toBe('echo 3');
  });

  it('supports nested parens for grouping', () => {
    expect(expandArithmetic('echo $(( (2+3) * 4 ))', {})).toBe('echo 20');
  });

  it('expands multiple $((...)) spans in one text', () => {
    expect(expandArithmetic('echo $((1+1)) and $((2+2))', {})).toBe('echo 2 and 4');
  });

  it('expands inside double quotes but not single quotes', () => {
    expect(expandArithmetic('echo "$((1+1))"', {})).toBe('echo "2"');
    expect(expandArithmetic("echo '$((1+1))'", {})).toBe("echo '$((1+1))'");
  });

  it('reads variables from the passed env', () => {
    expect(expandArithmetic('echo $((i+1))', { i: '9' })).toBe('echo 10');
  });
});
