'use client'

import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationPrevious,
  PaginationNext,
} from '@/components/ui/pagination'

interface SearchPaginationProps {
  currentPage: number
  totalPages: number
  onPageChange: (page: number) => void
}

export function SearchPagination({ currentPage, totalPages, onPageChange }: SearchPaginationProps) {
  if (totalPages <= 1) return null

  return (
    <div className="border-t border-slate-100 bg-slate-50/70 px-5 py-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-xs text-slate-500">
          当前第 {currentPage} 页 / 共 {totalPages} 页，每页 30 条
        </div>
        <Pagination className="mx-0 w-auto justify-end">
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious
                href="#"
                onClick={(event) => {
                  event.preventDefault()
                  onPageChange(currentPage - 1)
                }}
                className={
                  currentPage === 1
                    ? 'pointer-events-none opacity-50'
                    : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
                }
              />
            </PaginationItem>
            <PaginationItem>
              <span className="inline-flex h-9 items-center rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700">
                {currentPage} / {totalPages}
              </span>
            </PaginationItem>
            <PaginationItem>
              <PaginationNext
                href="#"
                onClick={(event) => {
                  event.preventDefault()
                  onPageChange(currentPage + 1)
                }}
                className={
                  currentPage === totalPages
                    ? 'pointer-events-none opacity-50'
                    : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
                }
              />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      </div>
    </div>
  )
}
