// =====================================================================
// TP1 - Analyse numerique matricielle
// Methodes de resolution directe des systemes lineaires
// Script principal : charge tp1.sci puis repond aux questions
// =====================================================================

clear;
clc;
exec(get_absolute_file_path("tp1.sce") + "tp1.sci", -1);


// ---------------------------------------------------------------------
// I. Systemes triangulaires
// ---------------------------------------------------------------------
mprintf("\n===== I. Systemes triangulaires =====\n");

// I.2.
L = [1 0 0; 2 3 0; 1 4 -1];
b = [1; 8; 10];
x = solinf(L, b);
mprintf("\nI.2. solinf(L,b) :\n"); disp(x);
mprintf("Verification L*x - b :\n"); disp(L*x - b);

// I.3.
U = [1 2 3; 0 4 8; 0 0 5];
b = [6; 16; 15];
x = solsup(U, b);
mprintf("\nI.3. solsup(U,b) :\n"); disp(x);
mprintf("Verification U*x - b :\n"); disp(U*x - b);


// ---------------------------------------------------------------------
// II. Elimination de Gauss
// ---------------------------------------------------------------------
mprintf("\n===== II. Elimination de Gauss =====\n");

A = [1 2 3; 5 2 1; 3 -1 1];
b = [5; 5; 6];

// II.2.
[At, bt] = trigGauss(A, b);
mprintf("\nII.2. trigGauss : At =\n"); disp(At);
mprintf("bt =\n"); disp(bt);

// II.3.
[At2, bt2] = trigGauss2(A, b);
mprintf("\nII.3. trigGauss2 : At =\n"); disp(At2);
mprintf("bt =\n"); disp(bt2);

// II.4. Comparaison des temps de calcul (1000 appels)
N = 1000;
tic();
for p = 1:N
    [At, bt] = trigGauss(A, b);
end
t1 = toc();
tic();
for p = 1:N
    [At2, bt2] = trigGauss2(A, b);
end
t2 = toc();
mprintf("\nII.4. Temps pour %d appels : trigGauss = %f s, trigGauss2 = %f s\n", N, t1, t2);
// Pour n = 3 les temps sont proches. Avec une matrice plus grande la
// difference devient tres nette :
n = 50;
Ag = rand(n, n) + n*eye(n, n);
bg = rand(n, 1);
tic(); [At, bt] = trigGauss(Ag, bg); t1 = toc();
tic(); [At2, bt2] = trigGauss2(Ag, bg); t2 = toc();
mprintf("     Pour n = %d : trigGauss = %f s, trigGauss2 = %f s\n", n, t1, t2);
// Conclusion : la version vectorisee (trigGauss2) est plus rapide que la
// version par boucles. Scilab est un langage interprete : chaque tour de
// boucle a un cout, alors que les operations sur des matrices/vecteurs
// extraits sont executees en code compile. Il faut donc privilegier les
// operations vectorielles dans Scilab (le gain augmente avec n).

// II.6.
x = ResolutionGauss(A, b);
mprintf("\nII.6. ResolutionGauss(A,b) :\n"); disp(x);
mprintf("Verification A*x - b :\n"); disp(A*x - b);


// ---------------------------------------------------------------------
// III. Factorisation LU
// ---------------------------------------------------------------------
mprintf("\n===== III. Factorisation LU =====\n");

// III.2.
[L, U] = LU(A);
mprintf("\nIII.2. L =\n"); disp(L);
mprintf("U =\n"); disp(U);
mprintf("Verification L*U - A :\n"); disp(L*U - A);
y = solinf(L, b);   // Ly = b
x = solsup(U, y);   // Ux = y
mprintf("Solution de Ax = b par LU :\n"); disp(x);

// III.4.
B1 = invGauss(A);
B2 = invLU(A);
mprintf("\nIII.4. invGauss(A) =\n"); disp(B1);
mprintf("invLU(A) =\n"); disp(B2);
mprintf("Verification A*invGauss(A) :\n"); disp(A*B1);
mprintf("Verification A*invLU(A) :\n"); disp(A*B2);
mprintf("Comparaison avec inv(A) de Scilab :\n"); disp(inv(A));

// III.5. Comparaison des temps (400 inversions)
N = 400;
tic();
for p = 1:N
    B1 = invGauss(A);
end
t1 = toc();
tic();
for p = 1:N
    B2 = invLU(A);
end
t2 = toc();
mprintf("\nIII.5. Temps pour %d inversions : invGauss = %f s, invLU = %f s\n", N, t1, t2);
// Conclusion : invLU est plus efficace. invGauss refait toute
// l'elimination de Gauss (cout en n^3) pour chacune des n colonnes, soit
// O(n^4) operations ; invLU factorise A une seule fois (O(n^3)) puis ne
// resout que 2n systemes triangulaires (O(n^2) chacun), soit O(n^3).


// ---------------------------------------------------------------------
// IV. Et si un pivot est nul... ?
// ---------------------------------------------------------------------
mprintf("\n===== IV. Pivot nul =====\n");

// IV.1. help find : find(C) renvoie les indices des elements vrais du
// booleen C ; find(C, 1) renvoie seulement le premier.

A = [1 2 1; 1 2 2; 3 3 1];
b = [0; 1; 1];

// IV.3.
[At2, bt2] = trigGauss2(A, b);
mprintf("\nIV.3. trigGauss2 : At =\n"); disp(At2);
mprintf("bt =\n"); disp(bt2);
// Le pivot a(2,2) devient nul a la 2e etape : division par 0, on obtient
// des Inf / Nan, la methode echoue alors que A est inversible (det(A) = 3).

[At3, bt3] = trigGauss3(A, b);
mprintf("trigGauss3 : At =\n"); disp(At3);
mprintf("bt =\n"); disp(bt3);
x = solsup(At3, bt3);
mprintf("Solution avec trigGauss3 + solsup :\n"); disp(x);
mprintf("Verification A*x - b :\n"); disp(A*x - b);

// IV.4. Echanger les lignes k et i de A revient a calculer P*A ou P est
// la matrice identite dont on a echange les lignes k et i (c'est une
// matrice de permutation, avec P = P' = inv(P)).

// IV.6.
[P, L, U] = PLU(A);
mprintf("\nIV.6. P =\n"); disp(P);
mprintf("L =\n"); disp(L);
mprintf("U =\n"); disp(U);
mprintf("Verification P*A - L*U :\n"); disp(P*A - L*U);
// Resolution de Ax = b : PAx = Pb  <=>  LUx = Pb
x = solsup(U, solinf(L, P*b));
mprintf("Solution de Ax = b par PLU :\n"); disp(x);
