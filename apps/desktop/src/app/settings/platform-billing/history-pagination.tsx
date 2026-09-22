import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Pagination,
  PaginationButton,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationNext,
  PaginationPrevious
} from '@/components/ui/pagination'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useI18n } from '@/i18n'
import { paginationItems } from '@/lib/pagination'

interface HistoryPaginationProps {
  page: number
  pageSize: number
  total: number
  onPage: (page: number) => void
  onPageSize: (size: number) => void
}

export function HistoryPagination({ page, pageSize, total, onPage, onPageSize }: HistoryPaginationProps) {
  const { t } = useI18n()
  const copy = t.platformBillingHistory
  const [jump, setJump] = useState('')
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const maxPage = Math.min(10000, pageCount)

  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs">
      <span className="text-muted-foreground">{copy.totalRecords(total)}</span>
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground">{copy.pageSize}</span>
        <Select onValueChange={value => onPageSize(Number(value))} value={String(pageSize)}>
          <SelectTrigger aria-label={copy.pageSize} className="w-20" size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[20, 50, 100].map(size => (
              <SelectItem key={size} value={String(size)}>
                {size}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Pagination className="mx-0 w-auto flex-wrap justify-start">
        <PaginationContent>
          <PaginationItem>
            <PaginationPrevious disabled={page <= 1} onClick={() => onPage(page - 1)} />
          </PaginationItem>
          {paginationItems(page, maxPage).map((item, index) => (
            <PaginationItem key={`${item}-${index}`}>
              {item === 'ellipsis' ? (
                <PaginationEllipsis />
              ) : (
                <PaginationButton
                  aria-label={copy.goToPage(item)}
                  isActive={item === page}
                  onClick={() => onPage(item)}
                >
                  {item}
                </PaginationButton>
              )}
            </PaginationItem>
          ))}
          <PaginationItem>
            <PaginationNext disabled={page >= maxPage} onClick={() => onPage(page + 1)} />
          </PaginationItem>
        </PaginationContent>
      </Pagination>
      <form
        className="flex items-center gap-1"
        onSubmit={event => {
          event.preventDefault()
          const value = Number(jump)

          if (Number.isInteger(value) && value >= 1 && value <= maxPage) {
            onPage(value)
            setJump('')
          }
        }}
      >
        <Input
          aria-label={copy.jumpToPage}
          className="w-16"
          max={maxPage}
          min={1}
          onChange={event => setJump(event.target.value)}
          required
          size="sm"
          step={1}
          type="number"
          value={jump}
        />
        <Button size="sm" type="submit" variant="ghost">
          {copy.jump}
        </Button>
      </form>
    </div>
  )
}
