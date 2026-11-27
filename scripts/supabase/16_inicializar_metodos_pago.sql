-- Inicializa la configuracion publica que el frontend estaba mostrando solo
-- desde sus valores por defecto. No reemplaza metodos existentes.
begin;

do $$
declare
  v_config jsonb;
  v_metodos jsonb;
  v_nequi text;
  v_banco text;
begin
  select coalesce(valor,'{}'::jsonb) into v_config
    from public.ajustes where clave='config' for update;
  if not found then v_config:='{}'::jsonb; end if;

  if jsonb_typeof(v_config->'metodos')='array'
     and jsonb_array_length(v_config->'metodos')>0 then
    return;
  end if;

  -- Conserva valores heredados si existen; si no, usa el Nequi publico
  -- configurado actualmente en js/config.js.
  v_nequi:=coalesce(nullif(btrim(v_config->>'nequi'),''),'3026393234');
  v_banco:=btrim(coalesce(v_config->>'banco',''));

  v_metodos:=jsonb_build_array(
    jsonb_build_object(
      'id','contra','nombre','Pago contra entrega','tipo','efectivo','activo',true,
      'instr','Pagas en efectivo cuando recibes tu pedido.'
    ),
    jsonb_build_object(
      'id','nequi','nombre','Nequi','tipo','transfer','activo',v_nequi<>'',
      'cuenta',v_nequi,'titular','','qr','',
      'instr','Envia el valor exacto a este numero y sube tu comprobante.'
    ),
    jsonb_build_object(
      'id','daviplata','nombre','Daviplata','tipo','transfer','activo',false,
      'cuenta','','titular','','qr','',
      'instr','Envia el valor exacto y sube tu comprobante.'
    ),
    jsonb_build_object(
      'id','banco','nombre','Transferencia bancaria','tipo','transfer',
      'activo',v_banco<>'','cuenta',v_banco,'titular','','qr','',
      'instr','Haz la transferencia por el valor exacto y sube tu comprobante.'
    ),
    jsonb_build_object(
      'id','tarjeta','nombre','Tarjeta o PSE','tipo','link','activo',false,
      'enlace','','instr','Paga en linea y escribe la referencia de tu pago.'
    )
  );

  insert into public.ajustes as actual(clave,valor)
    values('config',jsonb_set(v_config,'{metodos}',v_metodos,true))
  on conflict(clave) do update
    set valor=jsonb_set(
      case when jsonb_typeof(actual.valor)='object' then actual.valor else '{}'::jsonb end,
      '{metodos}',v_metodos,true
    )
    where case
      when jsonb_typeof(actual.valor->'metodos')='array'
        then jsonb_array_length(actual.valor->'metodos')=0
      else true
    end;
end $$;

notify pgrst,'reload schema';
commit;
