# Generator coverage audit — Grade 3 Mathematics

**Audit date:** 2026-08-08  
**Source:** the generator arrays embedded in the release `index.html`  

The release contains **166 generators**: 44 arithmetic/curriculum generators, 69 geometry generators, 38 Supreme/competition generators, and 15 select-all/multi generators.

For this audit, every generator eligible at each level was executed 100 times. Every eligible generator returned at least one well-formed domain label; no generator was missing from the level-topic discovery path.

| Level | Eligible generators | Distinct topic domains |
|---|---:|---:|
| 1. Beginner | 29 | 22 |
| 2. Developing | 56 | 33 |
| 3. Intermediate | 82 | 47 |
| 4. Advanced | 115 | 62 |
| 5. Supreme | 166 | 75 |

## Topics by level

### 1. Beginner — 22 topics

3D solids, Addition, Angles, Area, Bar graph, Division, Fractions, Geometry, Lines, Measurement, Measurement · Length, Multiples, Multiplication, Number patterns, Partitioning, Perimeter, Quadrilaterals, Shapes, Subtraction, Symmetry, Telling time, Word problem.

### 2. Developing — 33 topics

3D solids, Addition, Angles, Area, Bar graph, Comparing, Division, Even and odd, Fractions, Geometry, Lines, Measurement, Measurement · Length, Measurement · Units, Money, Multiples, Multiplication, Multiply by 10s, Number patterns, Partitioning, Perimeter, Picture graph, Place value, Quadrilaterals, Rounding, Shapes, Subtraction, Symmetry, Telling time, Transformations, Triangles, Unit fractions, Word problem.

### 3. Intermediate — 47 topics

3D solids, Addition, Angle sum, Angles, Area, Area vs perimeter, Bar graph, Compare fractions, Comparing, Counting figures, Cross-sections, Curved shapes, Data · Line plot, Division, Elapsed time, Equal expressions, Equivalent fractions, Even and odd, Fractions, Geometry, Lines, Measurement, Measurement · Length, Measurement · Units, Missing factor, Money, Multiples, Multiplication, Multiply by 10s, Nets, Number patterns, Partitioning, Perimeter, Picture graph, Place value, Properties of operations, Quadrilaterals, Rounding, Shape hierarchy, Shapes, Subtraction, Symmetry, Telling time, Transformations, Triangles, Unit fractions, Word problem.

### 4. Advanced — 62 topics

3D solids, Addition, Angle sum, Angles, Area, Area & perimeter, Area vs perimeter, Bar graph, Compare fractions, Comparing, Competition, Counting figures, Cross-sections, Curved shapes, Data · Line plot, Division, Elapsed time, Equal expressions, Equivalent fractions, Euler's formula, Even and odd, Fractions, Geometric patterns, Geometry, Lines, Measurement, Measurement · Length, Measurement · Units, Missing factor, Money, Multiples, Multiplication, Multiply by 10s, Nets, Number patterns, Number theory, Partitioning, Perimeter, Picture graph, Place value, Properties of operations, Quadrilaterals, Regular polygons, Rounding, Shape hierarchy, Shapes, Subtraction, Supreme · Age problem, Supreme · Counting, Supreme · Digit puzzle, Supreme · Geometry, Supreme · Number series, Supreme · Remainders, Supreme · Working backwards, Symmetry, Telling time, Transformations, Triangles, Two-step problem, Unit fractions, Unknown number, Word problem.

### 5. Supreme — 75 topics

3D solids, Addition, Angle sum, Angles, Area, Area & perimeter, Area vs perimeter, Bar graph, Compare fractions, Comparing, Competition, Counting figures, Cross-sections, Curved shapes, Data · Line plot, Diagonals, Division, Elapsed time, Equal expressions, Equivalent fractions, Euler's formula, Even and odd, Fractions, Geometric patterns, Geometry, Lines, Measurement, Measurement · Length, Measurement · Units, Missing factor, Money, Multi-step problem, Multiples, Multiplication, Multiply by 10s, Nets, Number patterns, Number theory, Painted cube, Partitioning, Perimeter, Picture graph, Place value, Properties of operations, Quadrilaterals, Regular polygons, Rounding, Shape hierarchy, Shapes, Spatial reasoning, Subtraction, Supreme · Age problem, Supreme · Area, Supreme · Averages, Supreme · Balance, Supreme · Counting, Supreme · Digit puzzle, Supreme · Geometry, Supreme · Logic, Supreme · Magic square, Supreme · Money, Supreme · Number series, Supreme · Number theory, Supreme · Patterns, Supreme · Rates, Supreme · Remainders, Supreme · Working backwards, Symmetry, Telling time, Transformations, Triangles, Two-step problem, Unit fractions, Unknown number, Word problem.

## Requested examples verified

- **Measurement** and **Measurement · Length** are available from Beginner; **Measurement · Units** appears from Developing.
- **Money**, **Even and odd**, **Comparing / Number Comparison**, **Place value**, **Rounding**, and **Picture graph** are available from Developing.
- **Missing factor**, **Elapsed time**, **Data · Line plot**, **Equivalent fractions**, and other full Grade 3 domains are available from Intermediate.
- Advanced and Supreme add multi-step, number-theory, competition, spatial, painted-cube, rates, averages, logic, and other challenge domains.

The Practice level page does not maintain a separate short topic list. It calls `allLevelGenerators(level)` and discovers the domains supported by all eligible `GEN`, `EXTRAGEN`, `GEOGEN`, `MULTIGEN`, and `OLYGEN` generators. Therefore the topic dashboard follows the generator engine as it evolves.

As a second discovery check, every one of the 166 generators was also sampled **200 times** at an eligible level to look for generators whose domain label changes stochastically. **No generator produced more than one domain label** in that run. This supports the UI's current one-domain-per-generator discovery approach and reduces the risk that a topic exists in a generator but is missed because only one sample is used for discovery.

## Note on “all topics”

The level pages show the topics **eligible for that level**, not all 75 domains at every difficulty. For example, Money and Odd/Even begin at Developing because their generators have `minL: 2`; Supreme-only challenge domains appear only at higher levels. At Supreme, all 166 generators are eligible and the audit observed **75 distinct domain labels**.
