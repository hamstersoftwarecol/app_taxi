export default function PaymentReturn() {
  return (
    <main className="login-screen">
      <h1>Estamos verificando tu pago.</h1>
      <p>
        El estado se actualizará cuando Stripe confirme la operación. Puedes
        volver a la aplicación para consultar el resultado.
      </p>
      <a className="button primary" href="rayo://payments/return">
        Volver a Rayo
      </a>
      <a className="button" href="/">
        Abrir panel web
      </a>
    </main>
  );
}
