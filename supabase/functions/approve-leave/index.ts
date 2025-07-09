import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.0.0";
import { sendGraphEmail } from "../helpers/sendGraphEmail.ts";
import { createCalendarEvent } from "../helpers/createCalendarEvent.ts";

// Ortak takvim e-posta adresi ortam değişkeninden alınır (Supabase'de "SHARED_CALENDAR_EMAIL" olarak eklenmeli!)
const sharedCalendarEmail = Deno.env.get("SHARED_CALENDAR_EMAIL");

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://leave-app-v2.vercel.app",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    // CORS preflight isteği için
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { request_id } = await req.json();

    // JWT'yi header'dan al
    const authHeader = req.headers.get("authorization") || "";
    const jwt = authHeader.replace("Bearer ", "");

    // Supabase bağlantısı (service role ile)
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Kullanıcı bilgisini JWT ile al
    const { data: { user }, error: userError } = await supabase.auth.getUser(jwt);
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Kullanıcı doğrulanamadı" }), {
        status: 401,
        headers: corsHeaders,
      });
    }

    // İzin kaydını al (tüm gerekli alanlar ile)
    const { data: leave, error: leaveError } = await supabase
      .from("leave_requests")
      .select("id, user_id, manager_email, status, start_date, end_date, days, location, note")
      .eq("id", request_id)
      .maybeSingle();

    if (leaveError || !leave) {
      return new Response(JSON.stringify({ error: "Talep bulunamadı" }), {
        status: 404,
        headers: corsHeaders,
      });
    }

    // Yöneticinin veya admin'in bilgisi
    const { data: userRow } = await supabase
      .from("users")
      .select("role, email, name")
      .eq("id", user.id)
      .maybeSingle();

    if (!userRow) {
      return new Response(JSON.stringify({ error: "Kullanıcı bulunamadı" }), {
        status: 401,
        headers: corsHeaders,
      });
    }

    // Yetki kontrolü: sadece yönetici veya admin onaylayabilir
    const isManager = userRow.email === leave.manager_email;
    const isAdmin = userRow.role === "admin";
    if (!isManager && !isAdmin) {
      return new Response(JSON.stringify({ error: "Yetkiniz yok." }), {
        status: 403,
        headers: corsHeaders,
      });
    }
    
    // Durumu 'Approved' olarak güncelle
    const { error: updateError } = await supabase
      .from("leave_requests")
      .update({ status: "Approved" })
      .eq("id", request_id);

    if (updateError) {
      return new Response(JSON.stringify({ error: "Onaylama başarısız" }), {
        status: 500,
        headers: corsHeaders,
      });
    }

    // Log kaydı (audit trail)
    try {
      await supabase.from("logs").insert([
        {
          user_id: user.id,
          actor_email: user.email,
          action: "approve_request",
          target_table: "leave_requests",
          target_id: leave.id,
          status_before: leave.status,
          status_after: "Approved",
          details: {
            start_date: leave.start_date,
            end_date: leave.end_date,
            days: leave.days,
            location: leave.location,
            note: leave.note,
          }
        }
      ]);
    } catch (logError) {
      console.error("Log kaydı başarısız:", logError);
      // İsterseniz log hatasını engelleyebilirsiniz
    }

    // Çalışan (izin sahibi) bilgisini al
    const { data: employee } = await supabase
      .from("users")
      .select("email, name")
      .eq("id", leave.user_id)
      .maybeSingle();

    if (!employee) {
      return new Response(JSON.stringify({ error: "Çalışan bulunamadı (mail gönderilemedi)" }), {
        status: 500,
        headers: corsHeaders,
      });
    }

    // Ortak takvime etkinlik oluştur (employee attendee)
    let eventId = null;
    try {
      const event = await createCalendarEvent({
        sharedCalendarEmail,
        employeeEmail: employee.email,
        employeeName: employee.name,
        leave: {
          start_date: leave.start_date,
          end_date: leave.end_date,
          note: leave.note
        }
      });
      const eventId = event.id;

      await supabase
  .from("leave_requests")
  .update({ calendar_event_id: eventId })
  .eq("id", leave.id);


      // Not: eventId bilgisini ileride silmek/iptal etmek için leave_requests tablosuna kaydedebilirsiniz
      // await supabase.from("leave_requests").update({ calendar_event_id: eventId }).eq("id", leave.id);
    } catch (calendarError) {
      console.error("Takvim etkinliği oluşturulamadı:", calendarError);
      // Takvim hatası olsa bile işleme devam edebilirsiniz
    }

    // Çalışana e-posta gönder
    await sendGraphEmail({
      to: employee.email,
      subject: "İzin Talebiniz Onaylandı",
      html: `
        <p>Sayın ${employee.name},</p>
        <p>Yöneticiniz ${userRow.name || ""} aşağıdaki izin talebinizi <b>onayladı</b>:</p>
        <ul>
          <li>Başlangıç: ${leave.start_date}</li>
          <li>Bitiş: ${leave.end_date}</li>
          <li>Gün: ${leave.days}</li>
        </ul>
        <p>İyi tatiller dileriz!</p>
      `
      // from eklemenize gerek yok, ortamdan çekilecek
    });

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: corsHeaders,
    });

  } catch (e) {
    return new Response(JSON.stringify({ error: "Beklenmeyen hata: " + (e?.message || e) }), {
      status: 500,
      headers: corsHeaders,
    });
  }
});
