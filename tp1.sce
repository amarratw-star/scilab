exec TP1.sci

L=[1 0 0; 2 3 0; 1 4 -1]
b=[1; 8; 10]
x=solinf(L,b)
L*x-b

x=solinfGPT(L,b)
L*x-b

U=[1 2 3; 0 4 8; 0 0 5]
b=[6; 16; 15]
x=solsup(U,b)
U*x-b

// ===== II. Elimination de Gauss =====
A=[1 2 3; 5 2 1; 3 -1 1]
b=[5; 5; 6]

// II.2
[At,bt]=trigGauss(A,b)

// II.3
[At,bt]=trigGauss2(A,b)

// II.4 : 1000 calculs de At et bt
tic();
for p=1:1000
    [At,bt]=trigGauss(A,b);
end
t1=toc()
tic();
for p=1:1000
    [At,bt]=trigGauss2(A,b);
end
t2=toc()
// Pour n=3 les temps sont proches ; sur une matrice 50x50 la difference est nette :
Ag=rand(50,50)+50*eye(50,50);
bg=rand(50,1);
tic(); [At,bt]=trigGauss(Ag,bg); t1=toc()
tic(); [At,bt]=trigGauss2(Ag,bg); t2=toc()
// Conclusion : la version vectorisee (trigGauss2) est plus rapide. Scilab est
// interprete : chaque tour de boucle coute cher, alors que les operations sur
// des vecteurs/matrices extraits sont executees en code compile. Il faut donc
// privilegier les operations vectorielles (le gain augmente avec n).

// II.6
x=ResolutionGauss(A,b)
A*x-b

// ===== III. Factorisation LU =====
// III.2
[L,U]=LU(A)
L*U-A
y=solinf(L,b)   // Ly=b
x=solsup(U,y)   // Ux=y
A*x-b

// III.4
B1=invGauss(A)
B2=invLU(A)
A*B1
A*B2
inv(A)

// III.5 : 400 inversions
tic();
for p=1:400
    B1=invGauss(A);
end
t1=toc()
tic();
for p=1:400
    B2=invLU(A);
end
t2=toc()
// Conclusion : invLU est plus efficace. invGauss refait toute l'elimination
// (cout n^3) pour chacune des n colonnes, soit O(n^4) ; invLU factorise A une
// seule fois (O(n^3)) puis resout seulement des systemes triangulaires (O(n^2)).

// ===== IV. Et si un pivot est nul... ? =====
// IV.1 : help find -> find(C) renvoie les indices ou C est vrai,
// find(C,1) renvoie seulement le premier.

A=[1 2 1; 1 2 2; 3 3 1]
b=[0; 1; 1]

// IV.3
[At,bt]=trigGauss2(A,b)
// -> le pivot a(2,2) devient nul : division par 0, on obtient Inf/Nan
// alors que A est inversible (det(A)=3).
[At,bt]=trigGauss3(A,b)
x=solsup(At,bt)
A*x-b

// IV.4 : echanger les lignes k et i de A revient a calculer P*A, ou P est la
// matrice identite dont on a echange les lignes k et i (matrice de permutation).

// IV.6
[P,L,U]=PLU(A)
P*A-L*U
x=solsup(U,solinf(L,P*b))   // PAx=Pb <=> LUx=Pb
A*x-b
