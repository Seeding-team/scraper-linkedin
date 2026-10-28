# "Word Editor trong AI Contract Review" (2026-10-27) - OnlyOffice Document Server tu-host.
# Can bat "services.CoAuthoring.autoAssembly" (mac dinh TAT trong anh goc) de Document Server
# tu gom thay doi dinh ky trong luc dang sua (khong chi luc dong phien) - neu khong, lenh
# forcesave cua ta luon bao "khong co gi moi" (error 4) ngay ca khi Sale vua go chu that su.
#
# QUAN TRONG (2026-10-27, bug that da gap): local.json GOC cua anh nen da san chua khung
# "services.CoAuthoring.token.enable.*"/"secret.*" (JWT ngau nhien duoc anh tu sinh san) ma
# entrypoint "update_ds_settings" CAN de ghi de JWT_SECRET that cua ta vao luc container start
# (dung tool `json -e "this.services.CoAuthoring.token.enable.browser = ..."`). Neu ta COPY de
# GHI DE toan bo file bang 1 file tu viet tay (chi co autoAssembly, thieu khung token/secret),
# lenh ghi JWT o entrypoint se throw "Cannot read properties of undefined (reading 'enable')"
# va FAIL AM THAM (khong lam container crash) - JWT_SECRET that KHONG BAO GIO duoc ap dung,
# OnlyOffice van dung secret placeholder cu trong local.json goc -> le ra la bi JWT mismatch
# that su xay ra ("Token bao mat tai lieu khong duoc tao dung"). Vi vay o day ta dung `json`
# tool (co san trong image) de PATCH THEM field autoAssembly vao local.json GOC cua anh ngay
# luc build, khong ghi de toan bo file - giu nguyen het khung token/secret goc cho entrypoint.
FROM onlyoffice/documentserver:latest
RUN /var/www/onlyoffice/documentserver/npm/json -I -q -f /etc/onlyoffice/documentserver/local.json -e \
    "this.services.CoAuthoring.autoAssembly = { enable: true, interval: '30s', step: '10s' }"
