# Gauntlet 3 format readers

The analysis runtime adds pyreadstat 1.3.6 (Apache-2.0; bundled ReadStat is MIT)
and PyArrow 25.0.0 (Apache-2.0). Their transitive native libraries are captured in
pixi.lock. No GPL reader is linked into Amani. R remains a separately executed
reference-analysis interpreter, as in the existing environment.

Pyreadstat reads SAS transport, SPSS and Stata, including numeric value labels.
PyArrow reads Parquet. Source metadata and arbitrary container annotations must
never become practice templates; host codecs rebuild containers from permitted
column inventories and explicit structural descriptors.
