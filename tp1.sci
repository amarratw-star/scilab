function x=solinf(L, b)
    n=size(L,1)
    x=zeros(n,1)
    x(1)=b(1)/L(1,1)
    for i=2:n
        x(i)=(b(i)-L(i,1:(i-1))*x(1:(i-1)))/L(i,i)
    end
endfunction

function x=solinfGPT(L, b)
    n = length(b);
    x = zeros(n, 1);
    for i = 1:n
        x(i) = (b(i) - L(i,1:i-1) * x(1:i-1)) / L(i,i);
    end
endfunction

function x=solsup(U, b)
    n=size(U,1)
    x=zeros(n,1)
    x(n)=b(n)/U(n,n)
    for i=n-1:-1:1
        x(i)=(b(i)-U(i,(i+1):n)*x((i+1):n))/U(i,i)
    end
endfunction

// I.1. La somme sum_{j=1}^{i-1} a(i,j)*x(j) est le produit du vecteur
// ligne extrait A(i,1:i-1) par le vecteur colonne extrait x(1:i-1).


// ---------------------------------------------------------------------
// II. Elimination de Gauss
// ---------------------------------------------------------------------

// II.1. Triangularisation de Gauss (version avec boucles, Algorithme 1)
function [At, bt] = trigGauss(A, b)
    n = size(A, 1);
    At = A;
    bt = b;
    for k = 1:n-1
        for i = k+1:n
            c = At(i,k) / At(k,k);
            bt(i) = bt(i) - c*bt(k);
            At(i,k) = 0;
            for j = k+1:n
                At(i,j) = At(i,j) - c*At(k,j);
            end
        end
    end
endfunction

// II.3. Triangularisation de Gauss (version vectorisee)
// Les boucles sur i et j sont remplacees par des operations sur des
// vecteurs / matrices extraits.
function [At, bt] = trigGauss2(A, b)
    n = size(A, 1);
    At = A;
    bt = b;
    for k = 1:n-1
        c = At(k+1:n,k) / At(k,k);                       // vecteur des coefficients
        bt(k+1:n) = bt(k+1:n) - c*bt(k);
        At(k+1:n,k+1:n) = At(k+1:n,k+1:n) - c*At(k,k+1:n); // produit colonne*ligne
        At(k+1:n,k) = 0;
    end
endfunction

// II.5. Resolution de Ax = b par elimination de Gauss
function x = ResolutionGauss(A, b)
    [At, bt] = trigGauss2(A, b);
    x = solsup(At, bt);
endfunction


// ---------------------------------------------------------------------
// III. Factorisation LU
// ---------------------------------------------------------------------

// III.1. Factorisation A = LU (L triangulaire inferieure a diagonale
// unite, contenant les coefficients c de l'Algorithme 1)
function [L, U] = LU(A)
    n = size(A, 1);
    U = A;
    L = eye(n, n);
    for k = 1:n-1
        c = U(k+1:n,k) / U(k,k);
        L(k+1:n,k) = c;
        U(k+1:n,k+1:n) = U(k+1:n,k+1:n) - c*U(k,k+1:n);
        U(k+1:n,k) = 0;
    end
endfunction

// III.3. Inverse de A colonne par colonne avec ResolutionGauss :
// la j-eme colonne de A^-1 est la solution de A x = e_j
function B = invGauss(A)
    n = size(A, 1);
    I = eye(n, n);
    B = zeros(n, n);
    for j = 1:n
        B(:,j) = ResolutionGauss(A, I(:,j));
    end
endfunction

// III.3. Inverse de A avec la factorisation LU (calculee une seule fois)
function B = invLU(A)
    n = size(A, 1);
    [L, U] = LU(A);
    I = eye(n, n);
    B = zeros(n, n);
    for j = 1:n
        y = solinf(L, I(:,j));
        B(:,j) = solsup(U, y);
    end
endfunction


// ---------------------------------------------------------------------
// IV. Et si un pivot est nul... ?
// ---------------------------------------------------------------------

// IV.2. Gauss avec permutation de lignes quand le pivot est (quasi) nul
function [At, bt] = trigGauss3(A, b)
    n = size(A, 1);
    At = A;
    bt = b;
    for k = 1:n-1
        if abs(At(k,k)) <= 1e-15 then
            // premier indice i > k tel que |a(i,k)| > 1e-15
            i = k + find(abs(At(k+1:n,k)) > 1e-15, 1);
            if i == [] then
                error("trigGauss3 : matrice non inversible");
            end
            // echange des lignes k et i dans A et b
            At([k i],:) = At([i k],:);
            bt([k i]) = bt([i k]);
        end
        c = At(k+1:n,k) / At(k,k);
        bt(k+1:n) = bt(k+1:n) - c*bt(k);
        At(k+1:n,k+1:n) = At(k+1:n,k+1:n) - c*At(k,k+1:n);
        At(k+1:n,k) = 0;
    end
endfunction

// IV.4. Echanger les lignes k et i de A revient a multiplier A a gauche
// par la matrice de permutation P(k,i) obtenue en echangeant les lignes
// k et i de la matrice identite :  P(k,i)*A.

// IV.5. Factorisation PA = LU avec permutation de lignes
function [P, L, U] = PLU(A)
    n = size(A, 1);
    U = A;
    L = eye(n, n);
    P = eye(n, n);
    for k = 1:n-1
        if abs(U(k,k)) <= 1e-15 then
            i = k + find(abs(U(k+1:n,k)) > 1e-15, 1);
            if i == [] then
                error("PLU : matrice non inversible");
            end
            U([k i],:) = U([i k],:);
            P([k i],:) = P([i k],:);
            // on echange aussi les multiplicateurs deja calcules
            L([k i],1:k-1) = L([i k],1:k-1);
        end
        c = U(k+1:n,k) / U(k,k);
        L(k+1:n,k) = c;
        U(k+1:n,k+1:n) = U(k+1:n,k+1:n) - c*U(k,k+1:n);
        U(k+1:n,k) = 0;
    end
endfunction
