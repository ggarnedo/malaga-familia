# Málaga en familia

App web del viaje familiar a Málaga (Pedregalejo), del 28 de diciembre de 2026 al 2 de enero de 2027.

- **Plan día a día, reservas, restaurantes e información práctica**: salen de `data/viaje.json`. Solo los cambia Gerardo.
- **Votos, tareas y gastos compartidos**: se guardan en Supabase y se protegen con una clave familiar.
- Se puede instalar en el móvil como una app y funciona sin conexión con el último plan descargado.

## Puesta en marcha de la base de datos (una sola vez)

1. Crea una cuenta gratuita en [supabase.com](https://supabase.com) y un proyecto nuevo (región: Europa).
2. Abre **SQL Editor**, pega el contenido de `supabase/esquema.sql`, cambia `CAMBIA-ESTA-CLAVE` por la clave familiar y pulsa **Run**.
3. En **Project Settings → API** copia la **Project URL** y la clave **anon public**, y ponlas en `config.js`.

Para cambiar la clave familiar más adelante, vuelve a ejecutar solo el bloque «Clave familiar» del archivo SQL con la clave nueva.
