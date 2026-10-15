// I.2
function x = solinf(L,b)
    n = size(L,1)
    x(1) = b(1)/L(1,1)
    for i = 2:n
        x(i) = (b(i)-L(i, 1:(i-1))*x(1:(i-1)))/L(i,i)
    end    
endfunction

// I.3
function x = solsup(U,b)
    n = size(U,1)
    x(n) = b(n)/U(n,n)
    for i = n-1:-1:1
        x(i) = (b(i)-U(i,(i+1):n)*x((i+1):n))/U(i,i)
    end    
endfunction


// II.1
function [A,b] = trigGauss(A,b)
    n = size(A,1)
    for k = 1:(n-1)
        for i = (k+1):n
            c = A(i,k)/A(k,k)
            b(i) = b(i)-c*b(k)
            A(i,k) = 0
            for j = (k+1):n
                A(i,j) = A(i,j)-c*A(k,j)
            end
        end   
    end
endfunction

// II.3 - Version vectorisée
function [A,b] = trigGauss2(A,b)
    n = size(A,1)
    for k = 1:(n-1)
        c = A((k+1):n,k)/A(k,k)
        b((k+1):n) = b((k+1):n)-c*b(k)
        A((k+1):n,k) = 0
        A((k+1):n,(k+1):n) = A((k+1):n,(k+1):n)-c*A(k,(k+1):n)
    end
endfunction

// II.5
function x = ResolutionGauss(A,b)
    [A,b] = trigGauss2(A,b)
    x = solsup(A,b)
endfunction


// III.1 - L stocke les coefficients c de l'algorithme 1, U est la matrice triangularisée
function [L,U] = LU(A)
    n = size(A,1)
    L = eye(n,n)
    for k = 1:(n-1)
        c = A((k+1):n,k)/A(k,k)
        L((k+1):n,k) = c
        A((k+1):n,k) = 0
        A((k+1):n,(k+1):n) = A((k+1):n,(k+1):n)-c*A(k,(k+1):n)
    end
    U = A
endfunction

// III.3 - La j-ème colonne de A^-1 est la solution de A*x = e_j
function B = invGauss(A)
    n = size(A,1)
    I = eye(n,n)
    for j = 1:n
        B(:,j) = ResolutionGauss(A,I(:,j))
    end
endfunction

function B = invLU(A)
    n = size(A,1)
    [L,U] = LU(A) // la factorisation n'est calculée qu'une seule fois
    I = eye(n,n)
    for j = 1:n
        B(:,j) = solsup(U,solinf(L,I(:,j)))
    end
endfunction


// IV.2 - Gauss avec échange de lignes si le pivot est nul
function [A,b] = trigGauss3(A,b)
    n = size(A,1)
    for k = 1:(n-1)
        if abs(A(k,k)) <= 1e-15 then
            i = k + find(abs(A((k+1):n,k)) > 1e-15, 1) // premier i>k tel que |a(i,k)|>1e-15
            A([k i],:) = A([i k],:) // échange des lignes k et i de A
            b([k i]) = b([i k])     // et de b
        end
        c = A((k+1):n,k)/A(k,k)
        b((k+1):n) = b((k+1):n)-c*b(k)
        A((k+1):n,k) = 0
        A((k+1):n,(k+1):n) = A((k+1):n,(k+1):n)-c*A(k,(k+1):n)
    end
endfunction

// IV.5 - Factorisation PA = LU
function [P,L,U] = PLU(A)
    n = size(A,1)
    L = eye(n,n)
    P = eye(n,n)
    for k = 1:(n-1)
        if abs(A(k,k)) <= 1e-15 then
            i = k + find(abs(A((k+1):n,k)) > 1e-15, 1)
            A([k i],:) = A([i k],:)
            P([k i],:) = P([i k],:)                   // on mémorise l'échange dans P
            L([k i],1:(k-1)) = L([i k],1:(k-1))       // et on échange les coefficients déjà calculés
        end
        c = A((k+1):n,k)/A(k,k)
        L((k+1):n,k) = c
        A((k+1):n,k) = 0
        A((k+1):n,(k+1):n) = A((k+1):n,(k+1):n)-c*A(k,(k+1):n)
    end
    U = A
endfunction
