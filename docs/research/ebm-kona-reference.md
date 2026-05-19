# Kona 1.0 — Energy-Based Model (EBM) by Logical Intelligence

**Source:** https://logicalintelligence.com/blog/energy-based-model-sudoku-demo
**Demo:** http://sudoku.logicalintelligence.com/
**Date noted:** May 2026

## What it is

Kona 1.0 is the first commercial Energy-Based Model (EBM) for AI reasoning. Unlike LLMs which generate token-by-token (autoregressive, probabilistic), EBMs evaluate the entire solution space simultaneously to find the minimum energy state — the valid answer. No guessing, no backtracking.

## Benchmark

96% on hard Sudoku vs ~2% for frontier LLMs (GPT-4, Claude, etc.). Sudoku is a proxy for constraint satisfaction problems where all constraints must be satisfied simultaneously.

## Relevance to AWIP

AWIP is full of constraint satisfaction problems:

- OKR trees that must be internally coherent
- Capability assignments that cannot conflict
- Workspace capacity planning (demand vs supply balance)
- Compliance gates that must all pass simultaneously

Kona could validate these with certainty rather than probability. Natural fit for the Sentinel layer as a constraint checker.

## Monitor

- Watch for public API release
- Track development at https://logicalintelligence.com
- Evaluate for integration into AWIP Sentinel when available
