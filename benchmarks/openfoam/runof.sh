#!/bin/bash
# runof.sh <case> <np>: decompose, simpleFoam in parallel, reconstruct the latest time; DONE when finished
cd "$1" && source /usr/share/openfoam/etc/bashrc >/dev/null 2>&1
rm -rf processor* DONE
if [ "$2" -gt 1 ]; then
  decomposePar -force > log.decompose 2>&1 && mpirun --allow-run-as-root -np $2 simpleFoam -parallel > log.simpleFoam 2>&1 && reconstructPar -latestTime > log.reconstruct 2>&1
else simpleFoam > log.simpleFoam 2>&1; fi
echo "exit $?" > DONE
