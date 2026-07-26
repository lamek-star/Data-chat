-- Repairs DataChat administrator password setup when pgcrypto is installed
-- in Supabase's standard `extensions` schema.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

alter function public.configure_datachat_admin(text, text)
  set search_path = public, extensions;

alter function public.create_datachat_pro_code(text, text, text)
  set search_path = public, extensions;

alter function public.list_datachat_pro_codes(text, text)
  set search_path = public, extensions;
