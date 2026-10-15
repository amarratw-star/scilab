clear  // efface toutes les variables assignées
xdel(winsid())  // ferme toutes les fenêtres graphiques
exec('TP1.sci')

//////
// I.1 : la somme est le produit du vecteur ligne L(i,1:(i-1)) par le vecteur colonne x(1:(i-1))

// I.2
L = [1 0 0 ; 2 3 0 ; 1 4 -1];
b = [1 ; 8 ; 10];
x = solinf(L,b)
norm(L*x-b,2) // vérification que L*x-b est bien le vecteur nul puisque la norme du vecteur est nulle

// I.3
U = [1 2 3 ; 0 4 8 ; 0 0 5];
b = [6 ; 16 ; 15];
x = solsup(U,b)
norm(U*x-b,2)


///////
// II.2
A = [1 2 3 ; 5 2 1 ; 3 -1 1];
b = [5 ; 5 ; 6];
[At,bt] = trigGauss(A,b)
norm(A*solsup(At,bt)-b,2)

// II.3
[At,bt] = trigGauss2(A,b)
norm(A*solsup(At,bt)-b,2)

// II.4
tic() // déclenche le chronomètre
for k=1:1000
    trigGauss(A,b);
end
t_TG1=toc() // arrête le chronomètre et stocke le temps écoulé depuis l'appel de tic

tic()
for k=1:1000
    trigGauss2(A,b);
end
t_TG2=toc()

format(5) // Pour n'afficher que 2 chiffre derrière la virgule
disp(['trigGauss2 est ', string(t_TG1/t_TG2), 'fois plus rapide que trigGauss'])
format(10)



// L'expérience suivante est plus adéquate pour mettre en lumière le gain de temps avec la version vectorisée : on augmente la dimension de la matrice
n=50 // Peut être augmenté selon les performances de la machine
M=100*rand(n,n); // crée une matrice nxn aléatoire
v=100*rand(n,1); // crée un vecteur nx1 aléatoire
disp(['Temps de calcul de l élimination d un système', string(n) 'x' string(n) 'avec trigGauss']);
tic()
    trigGauss(M,v);
toc()

disp(['Temps de calcul de l élimination d un système', string(n) 'x' string(n) 'avec trigGauss2']);
tic()
    trigGauss2(M,v);
toc()

// On peut également procéder à une visualisation graphique pour différentes valeurs de la dimension
val_dim_test=10:10:100; // valeurs des dimensions testées

nb_dim_test=length(val_dim_test);
t_TG1=zeros(1,nb_dim_test);
t_TG2=zeros(1,nb_dim_test);
for i=1:nb_dim_test
    M=100*rand(val_dim_test(i),val_dim_test(i));
    v=100*rand(val_dim_test(i),1);
    tic();
    trigGauss(M,v);
    t_TG1(i)=toc();
    tic();
    trigGauss2(M,v);
    t_TG2(i)=toc();
end

scf();
plot(val_dim_test,t_TG1,'-*r', val_dim_test,t_TG2,'-*b')
legend(['Boucles'; 'Vectorisation'])
xlabel('Dimension n')
ylabel('Temps (s)')


// II.6
x=ResolutionGauss(A,b)
norm(A*x-b,2)


///////
// III.2
[L,U] = LU(A)
norm(L*U-A,2) // vérification que A = LU
y = solinf(L,b) // on résout Ly = b
x = solsup(U,y) // puis Ux = y
norm(A*x-b,2)

// III.4
B1 = invGauss(A)
norm(A*B1-eye(3,3),2) // vérification que A*B1 = I
B2 = invLU(A)
norm(A*B2-eye(3,3),2)

// III.5
tic()
for k=1:400
    invGauss(A);
end
t_iG=toc()

tic()
for k=1:400
    invLU(A);
end
t_iLU=toc()

format(5)
disp(['invLU est ', string(t_iG/t_iLU), 'fois plus rapide que invGauss'])
format(10)

// Comme au II.4, la différence est plus visible en grande dimension
n=50
M=100*rand(n,n);
tic()
    invGauss(M);
t_iG=toc()
tic()
    invLU(M);
t_iLU=toc()
// invGauss refait toute l'élimination de Gauss pour chacune des n colonnes,
// alors que invLU ne factorise A qu'une seule fois puis ne résout que des
// systèmes triangulaires (beaucoup moins coûteux).


///////
// IV.1 : find(C) renvoie les indices des éléments vrais de C, find(C,1) seulement le premier

// IV.3
A = [1 2 1 ; 1 2 2 ; 3 3 1];
b = [0 ; 1 ; 1];
[At,bt] = trigGauss2(A,b) // le pivot a(2,2) devient nul : division par 0, on obtient Inf
[At,bt] = trigGauss3(A,b) // l'échange des lignes 2 et 3 permet de continuer
x = solsup(At,bt)
norm(A*x-b,2)

// IV.4 : échanger les lignes k et i de A revient à calculer P*A, où P est la
// matrice identité dont on a échangé les lignes k et i (matrice de permutation)

// IV.6
[P,L,U] = PLU(A)
norm(P*A-L*U,2) // vérification que PA = LU
x = solsup(U,solinf(L,P*b)) // Ax = b <=> PAx = Pb <=> LUx = Pb
norm(A*x-b,2)
